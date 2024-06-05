import { SchemaId, SchemaResponse, SchemaVersionResponse } from '@frequency-chain/api-augment/interfaces';
import { AnyNumber } from '@polkadot/types/types';
import { KeyringPair } from '@polkadot/keyring/types';
import { firstValueFrom } from 'rxjs';
import { ModelTypeStr, PayloadLocationStr, Schema, SchemaSettingStr } from './schema';
import { ExtrinsicHelper } from './extrinsicHelpers';
import { devAccounts } from './helpers';

export interface ISchemaBuilder {
  id?: SchemaId | AnyNumber;
  name?: string;
  version?: number;
  model?: any;
  modelType?: ModelTypeStr;
  payloadLocation?: PayloadLocationStr;
  settings?: SchemaSettingStr[];
  autodetectExisting?: boolean;
}

export class SchemaBuilder {
  private values: ISchemaBuilder = {};

  private static existingSchemaMap: Map<number, SchemaResponse> = new Map();

  constructor(values?: ISchemaBuilder) {
    if (values !== undefined) {
      Object.assign(this.values, values);
    }
  }

  public withModel(model: {}): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, id: undefined, model });
  }

  public withModelType(modelType: ModelTypeStr): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, id: undefined, modelType });
  }

  public withName(schemaNamespace: string, schemaDescriptor: string) {
    return new SchemaBuilder({ ...this.values, id: undefined, name: `${schemaNamespace}.${schemaDescriptor}` });
  }

  public withPayloadLocation(payloadLocation: PayloadLocationStr): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, id: undefined, payloadLocation });
  }

  public withSettings(settings: SchemaSettingStr[]): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, id: undefined, settings });
  }

  public withVersion(version: number) {
    return new SchemaBuilder({ ...this.values, id: undefined, version });
  }

  // eslint-disable-next-line class-methods-use-this
  public withExistingSchemaId(id: SchemaId | AnyNumber): SchemaBuilder {
    return new SchemaBuilder({ id });
  }

  public withAutoDetectExistingSchema(autodetectExisting = true) {
    return new SchemaBuilder({ ...this.values, autodetectExisting });
  }

  private schemaMatches(schema: SchemaResponse): boolean {
    return (
      schema.model.toHuman() === JSON.stringify(this.values.model) &&
      schema.model_type.type === this.values.modelType &&
      schema.payload_location.type === this.values.payloadLocation &&
      new Set(schema.settings.toArray().map((s) => s.toString())) === new Set(this.values.settings ? this.values.settings : []) &&
      JSON.stringify(schema.settings.toArray()) === JSON.stringify(this.values.settings ? [this.values.settings] : [])
    );
  }

  private static async fetchAndCacheSchema(schemaId: number): Promise<SchemaResponse> {
    let schemaResponse = SchemaBuilder.existingSchemaMap.get(schemaId);
    if (!schemaResponse) {
      schemaResponse = (await ExtrinsicHelper.apiPromise.rpc.schemas.getBySchemaId(schemaId)).unwrap();
      SchemaBuilder.existingSchemaMap.set(schemaId, schemaResponse!);
    }

    return schemaResponse!;
  }

  public async resolve(): Promise<Schema | undefined> {
    // If no id, we're creating a new schema on-chain
    if (this.values.id === undefined && this.values.autodetectExisting) {
      if ([this.values.model, this.values.modelType, this.values.payloadLocation].some((attr) => attr === undefined)) {
        throw new Error('Missing attribute(s) for schema creation');
      }

      // Try to auto-detect ID of existing schema
      if (this.values.name) {
        const schemaNameResponse = await ExtrinsicHelper.apiPromise.rpc.schemas.getVersions(this.values.name);
        if (schemaNameResponse.isSome) {
          const schemaId = (() => {
            let latest: SchemaVersionResponse | undefined;
            // eslint-disable-next-line no-restricted-syntax
            for (const val of schemaNameResponse.unwrap().toArray()) {
              if (this.values.version && val.schema_version.toNumber() === this.values.version) {
                return val.schema_id.toNumber();
              }

              if (!latest || latest.schema_version.lt(val.schema_version)) {
                latest = val;
              }
            }

            return latest?.schema_id.toNumber();
          })();

          if (schemaId) {
            const schema = await SchemaBuilder.fetchAndCacheSchema(schemaId);
            return new Schema(schema.schema_id, schema.model, schema.model_type.type, schema.payload_location.type, []);
          }
        }
      }

      const maxSchemas = (await ExtrinsicHelper.apiPromise.query.schemas.currentSchemaIdentifierMaximum()).toNumber();
      for (let i = 1; i <= maxSchemas; i += 1) {
        let schema: SchemaResponse;
        if (!SchemaBuilder.existingSchemaMap.has(i)) {
          // eslint-disable-next-line no-await-in-loop
          schema = (await ExtrinsicHelper.apiPromise.rpc.schemas.getBySchemaId(i)).unwrap();
          SchemaBuilder.existingSchemaMap.set(i, schema);
        } else {
          schema = SchemaBuilder.existingSchemaMap.get(i)!;
        }

        if (this.schemaMatches(schema)) {
          return new Schema(schema.schema_id, schema.model, schema.model_type.type, schema.payload_location.type, []);
        }
      }

      return undefined;
    }

    // otherwise, use an existing schema id to retrieve the details of a schema from the chain
    const response = await ExtrinsicHelper.apiPromise.rpc.schemas.getBySchemaId(this.values.id);
    if (response.isEmpty) {
      throw new Error(`No schema with id ${this.values.id}`);
    }
    const schema: SchemaResponse = response.unwrap();
    return new Schema(
      schema.schema_id,
      schema.model,
      schema.model_type.type,
      schema.payload_location.type,
      schema.settings.toArray().map((setting) => setting.type),
    );
  }

  public async build(creatorKeys: KeyringPair): Promise<Schema> {
    const schema = await this.resolve();
    if (schema) {
      return schema;
    }
    // If resolved schema, we're creating a new schema on-chain

    if ([this.values.model, this.values.modelType, this.values.payloadLocation].some((attr) => attr === undefined)) {
      throw new Error('Missing attribute(s) for schema creation');
    }

    let event: any;

    if (this.values.settings !== undefined) {
      [event] = await ExtrinsicHelper.createSchemaWithSettingsGov(
        creatorKeys,
        devAccounts[0].keys, // TODO: allow for a different funding method for non-dev chains
        this.values.model,
        this.values.modelType!,
        this.values.payloadLocation!,
        this.values.settings!,
      ).sudoSignAndSend();
    } else {
      [event] = await ExtrinsicHelper.createSchema(creatorKeys, this.values.model, this.values.modelType!, this.values.payloadLocation!).fundAndSend();
    }
    if (!event || !ExtrinsicHelper.api.events.schemas.SchemaCreated.is(event)) {
      throw new Error('Schema not created');
    }

    return new Schema(event.data.schemaId, this.values.model!, this.values.modelType!, this.values.payloadLocation!, this.values.settings ? this.values.settings : []);
  }
}
