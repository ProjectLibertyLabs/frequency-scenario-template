import '@frequency-chain/api-augment';
import { IntentId } from '@frequency-chain/api-augment/interfaces';
import { AnyNumber } from '@polkadot/types/types';
import { KeyringPair } from '@polkadot/keyring/types';
import { ExtrinsicHelper } from './extrinsicHelpers.js';
import { IIntent, Intent, IntentSettingStr, PayloadLocationStr } from './intent';
import { BuilderWithName } from './builder';
import { u8aToString } from '@polkadot/util';
import type { CommonPrimitivesSchemaMappedEntityIdentifier } from '@polkadot/types/lookup';
import { Bytes, StorageKey } from '@polkadot/types';

export interface IIntentBuilder {
  id?: IntentId | AnyNumber;
  name?: string;
  payloadLocation?: PayloadLocationStr;
  settings?: IntentSettingStr[];
  autodetectExisting?: boolean;
}

export class IntentBuilder extends BuilderWithName<IIntentBuilder, typeof Intent> {
  private static existingIntentMap = new Map<number, IIntent>();

  readonly withPayloadLocation = this.propertySetter('payloadLocation');
  readonly withSettings = this.propertySetter('settings');
  readonly withAutoDetectExisting = this.propertySetter('autodetectExisting');

  public withExistingIntentId(id: IntentId | AnyNumber): IntentBuilder {
    return new IntentBuilder({ id });
  }

  private static async getNameForIntentId(intentId: number): Promise<string | undefined> {
    // Resolve the name of the Intent
    const nameResponse: [StorageKey<[Bytes, Bytes]>, CommonPrimitivesSchemaMappedEntityIdentifier][] =
      (await ExtrinsicHelper.apiPromise.query.schemas.nameToMappedEntityIds.entries()) as unknown as [StorageKey<[Bytes, Bytes]>, CommonPrimitivesSchemaMappedEntityIdentifier][];
    const entry = nameResponse.find(([_, value]) => {
      return intentId === value.asIntent.toNumber();
    });
    if (entry) {
      const [protocol, descriptor] = entry[0].args.map((arg) => u8aToString(arg.toU8a()));
      return `${protocol}:${descriptor}`;
    }

    return undefined;
  }

  private static async fetchAndCacheIntent(intentId: number | string): Promise<IIntent | undefined> {
    let id: number | undefined = typeof intentId === 'number' ? intentId : undefined;
    let intentResponse: IIntent | undefined;
    if (typeof intentId === 'string') {
      const name = intentId;
      id = undefined;
      const response = await ExtrinsicHelper.apiPromise.call.schemasRuntimeApi.getRegisteredEntitiesByName(name);
      if (response.isSome && response.unwrap().length > 0) {
        const entity = response.unwrap()[0];
        if (entity.entityId.isIntent) {
          id = entity.entityId.asIntent.toNumber();
        }
      }
    }
    if (id) {
      intentResponse = IntentBuilder.existingIntentMap.get(id);
      if (!intentResponse) {
        const response = await ExtrinsicHelper.apiPromise.call.schemasRuntimeApi.getIntentById(id, true);
        if (response.isSome) {
          const intent = response.unwrap();
          const name = await IntentBuilder.getNameForIntentId(intent.intentId.toNumber());
          if (!name) {
            throw new Error(`Unable to resolve name for Intent with id ${intent.intentId.toNumber()}`);
          }
          intentResponse = {
            id: intent.intentId.toNumber(),
            name,
            payloadLocation: intent.payloadLocation.type,
            settings: intent.settings.toArray().map((setting) => setting.type),
            schemas: intent.schemaIds.unwrapOrDefault().map((schemaId) => schemaId.toNumber()),
          };
          IntentBuilder.existingIntentMap.set(id!, intentResponse!);
        }
      }
    }

    return intentResponse;
  }

  public async resolve(): Promise<Intent | undefined> {
    // If no id, we'll resolve by name if indicated
    if (this.values.id === undefined) {
      if (this.values.autodetectExisting && this.values.name) {
        const intentResponse = await IntentBuilder.fetchAndCacheIntent(this.values.name);
        if (intentResponse) {
          return new Intent({
            id: intentResponse.id,
            name: this.values.name,
            payloadLocation: intentResponse.payloadLocation,
            settings: intentResponse.settings,
            schemas: intentResponse.schemas,
          });
        } else {
          throw new Error(`No Intent with name ${this.values.name}`);
        }
      }

      return undefined;
    }

    // otherwise, use an existing Intent id to retrieve the details of an Intent from the chain
    const response = await ExtrinsicHelper.apiPromise.call.schemasRuntimeApi.getIntentById(this.values.id, true);
    if (response.isEmpty) {
      throw new Error(`No Intent with id ${this.values.id}`);
    }
    const intent = response.unwrap();
    const name = await IntentBuilder.getNameForIntentId(intent.intentId.toNumber());
    if (!name) {
      throw new Error(`Unable to resolve name for Intent with id ${intent.intentId.toNumber()}`);
    }
    return new Intent({
      id: intent.intentId.toNumber(),
      name,
      payloadLocation: intent.payloadLocation.type,
      settings: intent.settings.toArray().map((setting) => setting.type),
      schemas: intent.schemaIds.unwrapOrDefault().map((schemaId) => schemaId.toNumber()),
    });
  }

  public async build(creatorKeys: KeyringPair): Promise<Intent> {
    let intent: Intent | undefined;
    try {
      intent = await this.resolve();
    } catch (e: any) {
      console.warn(`Unable to resolve Intent with name ${this.values.name}. Will attempt to create a new Intent instead.`);
    }

    if (intent) {
      return intent;
    }

    // If no resolved Intent, we're creating a new Intent on-chain
    if ([this.values.name, this.values.payloadLocation].some((attr) => attr === undefined)) {
      throw new Error('Missing attribute(s) for Intent creation');
    }

    const [event] = await ExtrinsicHelper.createIntent(creatorKeys, this.values.payloadLocation!, this.values.settings || [], this.values.name!).fundAndSend();
    if (!event || !ExtrinsicHelper.api.events.schemas.IntentCreated.is(event)) {
      throw new Error('Intent not created');
    }

    return new Intent({
      id: event.data.intentId.toNumber(),
      name: this.values.name!,
      payloadLocation: this.values.payloadLocation!,
      settings: this.values.settings ? this.values.settings : [],
    });
  }
}
