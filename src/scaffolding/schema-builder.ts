import '@frequency-chain/api-augment';
import { KeyringPair } from '@polkadot/keyring/types';
import { ISchema, ModelTypeStr, Schema } from './schema';
import { ExtrinsicHelper } from './extrinsicHelpers';
import { IntentBuilder } from './intent-builder';
import { BuilderWithName } from './builder';

export interface ISchemaBuilder {
  id?: number;
  name?: string;
  intentId?: number;
  model?: any;
  modelType?: ModelTypeStr;
  autodetectExisting?: boolean;
}

export class SchemaBuilder extends BuilderWithName<ISchemaBuilder, typeof Schema> {
  private static existingSchemaMap = new Map<number, ISchema>();

  readonly withIntentId = this.propertySetter('intentId');
  readonly withModel = this.propertySetter('model');
  readonly withModelType = this.propertySetter('modelType');
  readonly withAutoDetectExistingSchema = this.propertySetter('autodetectExisting');

  public withExistingSchemaId(id: number): SchemaBuilder {
    return new SchemaBuilder({ id });
  }

  private schemaMatches(schema: ISchema): boolean {
    return schema.intentId === this.values.intentId && JSON.stringify(schema.model) === JSON.stringify(this.values.model) && schema.modelType === this.values.modelType;
  }

  private static async fetchAndCacheSchema(schemaId: number): Promise<ISchema> {
    let schemaResponse = SchemaBuilder.existingSchemaMap.get(schemaId);
    if (!schemaResponse) {
      const response = (await ExtrinsicHelper.apiPromise.call.schemasRuntimeApi.getSchemaById(schemaId)).unwrap();
      schemaResponse = {
        id: response.schemaId.toNumber(),
        intentId: response.intentId.toNumber(),
        model: response.model.toU8a(),
        modelType: 'AvroBinary',
        payloadLocation: 'OnChain',
      };
      SchemaBuilder.existingSchemaMap.set(schemaId, schemaResponse!);
    }

    return schemaResponse!;
  }

  public async resolve(): Promise<Schema | undefined> {
    // If no id, we're resolving a schema from on-chain
    if (this.values.id === undefined) {
      // If a name is present, use it to look up the associated Intent and get its latest schema
      if (this.values.name) {
        const intent = await new IntentBuilder({ name: this.values.name }).resolve();
        if (!intent) {
          throw new Error(`Schema resolution error: unable to resolve Intent with name ${this.values.name}`);
        }

        if (!intent.schemas || intent.schemas.length === 0) {
          throw new Error(`Schema resolution error: Intent ${this.values.name} has no associated schemas`);
        }

        this.values.id = intent.schemas[intent.schemas.length - 1];
      } else if (this.values.autodetectExisting) {
        // Use the model to try and look up an existing schema
        if ([this.values.model, this.values.modelType, this.values.intentId].some((attr) => attr === undefined)) {
          throw new Error('Missing attribute(s) for schema creation');
        }

        const schemaIds = await ExtrinsicHelper.apiPromise.query.schemas.schemaInfos.keys();
        for (const key of schemaIds) {
          const id = key.args[0].toNumber();
          const schema = await SchemaBuilder.fetchAndCacheSchema(id);
          if (this.schemaMatches(schema)) {
            return new Schema(schema);
          }
        }
      }
      return undefined;
    }

    // otherwise, use an existing schema id to retrieve the details of a schema from the chain
    const schema = await SchemaBuilder.fetchAndCacheSchema(this.values.id);
    return new Schema(schema);
  }

  public async build(creatorKeys: KeyringPair): Promise<Schema> {
    const schema = await this.resolve();
    if (schema) {
      return schema;
    }

    // If no resolved schema, we're creating a new schema on-chain
    if ([this.values.model, this.values.modelType, this.values.intentId].some((attr) => attr === undefined)) {
      throw new Error('Missing attribute(s) for schema creation');
    }

    const [event] = await ExtrinsicHelper.createSchema(creatorKeys, this.values.model, this.values.modelType!, this.values.intentId!).fundAndSend();

    if (!event || !ExtrinsicHelper.api.events.schemas.SchemaCreated.is(event)) {
      throw new Error('Schema not created');
    }

    // get the corresponding Intent
    const intent = await new IntentBuilder({ id: this.values.intentId! }).resolve();
    if (!intent) {
      throw new Error(`Unexpected error: unable to resolve Intent with id ${this.values.intentId}`);
    }

    return new Schema({
      intentId: intent.id,
      id: event.data.schemaId.toNumber(),
      model: this.values.model!,
      modelType: this.values.modelType!,
      payloadLocation: intent.payloadLocation,
      settings: intent.settings,
    });
  }
}
