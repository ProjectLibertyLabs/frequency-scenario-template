import { SchemaId, SchemaResponse } from '@frequency-chain/api-augment/interfaces';
import { AnyNumber } from '@polkadot/types/types';
import { KeyringPair } from '@polkadot/keyring/types';
import { lastValueFrom } from 'rxjs';
import { ModelTypeStr, PayloadLocationStr, Schema, SchemaSettingStr } from './schema';
import { ExtrinsicHelper } from './extrinsicHelpers';
import { devAccounts } from './helpers';

export interface ISchemaBuilder {
  id?: SchemaId | AnyNumber;
  model?: {};
  modelType?: ModelTypeStr;
  payloadLocation?: PayloadLocationStr;
  setting?: SchemaSettingStr;
}

export class SchemaBuilder {
  private values: ISchemaBuilder = {};

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

  public async build(delegatorKeys: KeyringPair): Promise<Schema> {
    // If no id, we're creating a new schema on-chain
    if (this.values.id === undefined) {
      if ([this.values.model, this.values.modelType, this.values.payloadLocation].some((attr) => attr === undefined)) {
        throw new Error('Missing attribute(s) for schema creation');
      }

      let event: any;

      if (this.values.setting !== undefined) {
        [event] = await ExtrinsicHelper.createSchemaWithSettingsGov(
          delegatorKeys,
          devAccounts[0].keys,
          this.values.model,
          this.values.modelType!,
          this.values.payloadLocation!,
          this.values.setting!,
        ).sudoSignAndSend();
      } else {
        [event] = await ExtrinsicHelper.createSchema(delegatorKeys, this.values.model, this.values.modelType!, this.values.payloadLocation!).fundAndSend();
      }
      if (!event || !ExtrinsicHelper.api.events.schemas.SchemaCreated.is(event)) {
        throw new Error('Schema not created');
      }

      return new Schema(event.data.schemaId, this.values.model!, this.values.modelType!, this.values.payloadLocation!, this.values.setting ? [this.values.setting] : []);
    }
    // otherwise, use an existing schema id to retrieve the details of a schema from the chain

    const response = await lastValueFrom(ExtrinsicHelper.api.rpc.schemas.getBySchemaId(this.values.id));
    if (response.isEmpty) {
      throw new Error(`No schema with id ${this.values.id}`);
    }
    const schema: SchemaResponse = response.unwrap();
    return new Schema(
      schema.schema_id,
      schema.model,
      schema.model_type.type,
      schema.payload_location.type,
      schema.setting.toArray().map((setting) => setting.type),
    );
  }
}
