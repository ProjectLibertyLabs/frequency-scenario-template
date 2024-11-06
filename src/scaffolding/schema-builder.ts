import '@frequency-chain/api-augment';
import { SchemaId, SchemaResponse, SchemaVersionResponse } from '@frequency-chain/api-augment/interfaces';
import { AnyNumber } from '@polkadot/types/types';
import { KeyringPair } from '@polkadot/keyring/types';
import { ModelTypeStr, PayloadLocationStr, Schema, SchemaSettingStr } from './schema.js';
import { ExtrinsicHelper } from './extrinsicHelpers.js';
import { devAccounts } from './helpers.js';

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

  private static existingSchemaMap = new Map<number, SchemaResponse>();

  constructor(values?: ISchemaBuilder) {
    if (values !== undefined) {
      Object.assign(this.values, values);
    }
  }

  public withNamedVersion(name: string, version?: number): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, name, version });
  }

  public withModel(model: object): SchemaBuilder {
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
      // Try to auto-detect ID of existing schema
      if (this.values.name) {
        const schemaNameResponse = await ExtrinsicHelper.apiPromise.rpc.schemas.getVersions(this.values.name);
        if (schemaNameResponse.isSome) {
          const schemaId = (() => {
            let latest: SchemaVersionResponse | undefined;

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
            return new Schema({
              id: schema.schema_id,
              name: this.values.name,
              model: schema.model,
              modelType: schema.model_type.type,
              payloadLocation: schema.payload_location.type,
              settings: [],
            });
          }
        }
      }

      // No name (or name not found), we'll need to use the model to try and look up an existing schema
      if ([this.values.model, this.values.modelType, this.values.payloadLocation].some((attr) => attr === undefined)) {
        throw new Error('Missing attribute(s) for schema creation');
      }

      const maxSchemas = (await ExtrinsicHelper.apiPromise.query.schemas.currentSchemaIdentifierMaximum()).toNumber();
      for (let i = 1; i <= maxSchemas; i += 1) {
        let schema: SchemaResponse;
        if (!SchemaBuilder.existingSchemaMap.has(i)) {
          schema = (await ExtrinsicHelper.apiPromise.rpc.schemas.getBySchemaId(i)).unwrap();
          SchemaBuilder.existingSchemaMap.set(i, schema);
        } else {
          schema = SchemaBuilder.existingSchemaMap.get(i)!;
        }

        if (this.schemaMatches(schema)) {
          return new Schema({ id: schema.schema_id, model: schema.model, modelType: schema.model_type.type, payloadLocation: schema.payload_location.type, settings: [] });
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
    return new Schema({
      id: schema.schema_id,
      model: schema.model,
      modelType: schema.model_type.type,
      payloadLocation: schema.payload_location.type,
      settings: schema.settings.toArray().map((setting) => setting.type),
    });
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

    return new Schema({
      id: event.data.schemaId,
      model: this.values.model!,
      modelType: this.values.modelType!,
      payloadLocation: this.values.payloadLocation!,
      settings: this.values.settings ? this.values.settings : [],
    });
  }
}
