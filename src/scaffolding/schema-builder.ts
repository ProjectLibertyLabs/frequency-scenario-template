import '@frequency-chain/api-augment';
import { SchemaId, SchemaResponse } from '@frequency-chain/api-augment/interfaces';
import { AnyNumber } from '@polkadot/types/types';
import { KeyringPair } from '@polkadot/keyring/types';
import { firstValueFrom } from 'rxjs';
import { isArray } from '@polkadot/util';
import { ModelTypeStr, PayloadLocationStr, Schema, SchemaSettingStr } from './schema';
import { EventMap, ExtrinsicHelper } from './extrinsicHelpers';
import { devAccounts } from './helpers';

export interface ISchemaBuilder {
  id?: SchemaId | AnyNumber;
  model?: {};
  modelType?: ModelTypeStr;
  payloadLocation?: PayloadLocationStr;
  setting?: SchemaSettingStr;
  autodetectExisting?: boolean;
  name?: string;
  version?: number;
}

export class SchemaBuilder {
  private values: ISchemaBuilder = {};

  private existingSchemaMap: Map<number, SchemaResponse> = new Map();

  constructor(values?: ISchemaBuilder) {
    if (values !== undefined) {
      Object.assign(this.values, values);
    }
  }

  public withNamedVersion(name: string, version?: number): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, name, version });
  }

  public withModel(model: {}): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, id: undefined, model });
  }

  public withModelType(modelType: ModelTypeStr): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, id: undefined, modelType });
  }

  public withPayloadLocation(payloadLocation: PayloadLocationStr): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, id: undefined, payloadLocation });
  }

  public withSetting(setting: SchemaSettingStr): SchemaBuilder {
    return new SchemaBuilder({ ...this.values, id: undefined, setting });
  }

  // eslint-disable-next-line class-methods-use-this
  public withExistingSchemaId(id: SchemaId | AnyNumber): SchemaBuilder {
    return new SchemaBuilder({ id });
  }

  public withAutoDetectExistingSchema(autodetectExisting = true) {
    return new SchemaBuilder({ ...this.values, autodetectExisting });
  }

  private schemaMatches(schema: SchemaResponse): boolean {
    const settings = schema.settings.toArray();
    const settingsStr = JSON.stringify(settings);
    const thisStr = JSON.stringify(this.values.setting ? [this.values.setting] : []);
    return (
      schema.model.toUtf8() === JSON.stringify(this.values.model) &&
      schema.model_type.type === this.values.modelType &&
      schema.payload_location.type === this.values.payloadLocation &&
      JSON.stringify(schema.settings.toArray()) === JSON.stringify(this.values.setting ? [this.values.setting] : [])
    );
  }

  public async build(delegatorKeys: KeyringPair): Promise<Schema> {
    let actualName: string | undefined;

    // If no id, but name supplied, look up schema on-chain
    if (!this.values.id && !!this.values.name) {
      // Try to look up existing schema by name
      const response = await ExtrinsicHelper.apiPromise.rpc.schemas.getVersions(this.values.name);
      if (response.isSome) {
        const resolvedSchemas = response.unwrap().toArray();
        if (this.values?.version) {
          const index = resolvedSchemas.findIndex((resp) => resp.schema_version.toNumber() === this.values.version);
          if (index !== -1) {
            this.values.id = resolvedSchemas[index].schema_id.toNumber();
          }
        }

        if (!this.values.id && resolvedSchemas.length > 0) {
          this.values.id = resolvedSchemas[resolvedSchemas.length - 1].schema_id.toNumber();
        }

        actualName = this.values.name;
        console.info(`Found schema id ${this.values.id} for ${this.values.name}`);
      }
    }
    // If no ID, we're creating a new schema on-chain
    if (this.values.id === undefined) {
      if ([this.values.model, this.values.modelType, this.values.payloadLocation].some((attr) => attr === undefined)) {
        throw new Error('Missing attribute(s) for schema creation');
      }

      let event: any;
      let eventMap: EventMap;

      // Try to auto-detect ID of existing schema
      if (this.values.autodetectExisting) {
        const maxSchemas = (await firstValueFrom(ExtrinsicHelper.api.query.schemas.currentSchemaIdentifierMaximum())).toNumber();
        for (let i = 1; i <= maxSchemas; i += 1) {
          let schema: SchemaResponse;
          if (!this.existingSchemaMap.has(i)) {
            // eslint-disable-next-line no-await-in-loop
            schema = (await ExtrinsicHelper.apiPromise.rpc.schemas.getBySchemaId(i)).unwrap();
            this.existingSchemaMap.set(i, schema);
          } else {
            schema = this.existingSchemaMap.get(i)!;
          }

          if (this.schemaMatches(schema)) {
            return new Schema({ id: schema.schema_id, model: schema.model, modelType: schema.model_type.type, payloadLocation: schema.payload_location.type });
          }
        }
      }

      if (this.values.setting !== undefined) {
        [event, eventMap] = await ExtrinsicHelper.createSchemaWithSettingsGov(
          delegatorKeys,
          devAccounts[0].keys,
          this.values.model,
          this.values.modelType!,
          this.values.payloadLocation!,
          this.values.setting!,
          this.values?.name,
        ).sudoSignAndSend();
      } else {
        [event, eventMap] = await ExtrinsicHelper.createSchema(
          delegatorKeys,
          this.values.model,
          this.values.modelType!,
          this.values.payloadLocation!,
          [],
          this.values?.name,
        ).fundAndSend();
      }
      if (!event || !ExtrinsicHelper.api.events.schemas.SchemaCreated.is(event)) {
        throw new Error('Schema not created');
      }

      const nameEvent = eventMap?.SchemaNameCreated;
      if (nameEvent && !isArray(nameEvent) && ExtrinsicHelper.apiPromise.events.schemas.SchemaNameCreated.is(nameEvent)) {
        actualName = nameEvent.data.name.toString();
      }

      if (!actualName) {
        actualName = this.values.name;
      }

      return new Schema({
        id: event.data.schemaId,
        model: this.values.model!,
        modelType: this.values.modelType!,
        payloadLocation: this.values.payloadLocation!,
        settings: this.values.setting ? [this.values.setting] : [],
        name: actualName,
      });
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
      name: actualName,
    });
  }
}
