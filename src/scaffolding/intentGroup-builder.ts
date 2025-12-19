import '@frequency-chain/api-augment';
import {KeyringPair} from '@polkadot/keyring/types';
import {ExtrinsicHelper} from './extrinsicHelpers.js';
import {IIntentGroup, IntentGroup} from "./intentGroup";
import {BuilderWithName} from "#app/scaffolding/builder";

export interface IIntentGroupBuilder {
    id?: number;
    name?: string;
    intents?: number[];
    autodetectExisting?: boolean;
}

export class IntentGroupBuilder extends BuilderWithName<IIntentGroupBuilder, typeof IntentGroup> {
    private static existingIntentGroupMap = new Map<number, IIntentGroup>();

    readonly withAutoDetectExisting = this.propertySetter('autodetectExisting');

    public withExistingIntentGroupId(id: number): IntentGroupBuilder {
        return new IntentGroupBuilder({id});
    }

    private static async fetchAndCacheIntentGroup(intentGroupId: number | string): Promise<IIntentGroup | undefined> {
        let id: number | undefined = typeof intentGroupId === 'number' ? intentGroupId : undefined;
        const name: string | undefined = typeof intentGroupId === 'string' ? intentGroupId : undefined;
        let intentGroupResponse: IIntentGroup | undefined;
        if (name !== undefined) {
            id = undefined;
            const response = await ExtrinsicHelper.apiPromise.call.schemasRuntimeApi.getRegisteredEntitiesByName(name);
            if (response.isSome && response.unwrap().length > 0) {
                const entity = response.unwrap()[0];
                if (entity.entityId.isIntentGroup) {
                    id = entity.entityId.asIntentGroup.toNumber();
                }
            }
        }
        if (id) {
            intentGroupResponse = IntentGroupBuilder.existingIntentGroupMap.get(id);
            if (!intentGroupResponse) {
                const response = await ExtrinsicHelper.apiPromise.call.schemasRuntimeApi.getIntentGroupById(intentGroupId);
                if (response.isSome) {
                    const intentGroup = response.unwrap();
                    intentGroupResponse = {
                        id: intentGroup.intentGroupId.toNumber(),
                        name,
                        intents: intentGroup.intentIds.map((intentId) => intentId.toNumber()),
                    }
                    IntentGroupBuilder.existingIntentGroupMap.set(id!, intentGroupResponse!);
                }
            }
        }

        return intentGroupResponse;
    }

    public async resolve(): Promise<IntentGroup | undefined> {
        // If no id, we'll resolve by name if indicated
        if (this.values.id === undefined) {
            if (this.values.autodetectExisting && this.values.name) {
                const intentGroupResponse = await IntentGroupBuilder.fetchAndCacheIntentGroup(this.values.name);
                if (intentGroupResponse) {
                    return new IntentGroup({
                        id: intentGroupResponse.id,
                        name: this.values.name,
                        intents: intentGroupResponse.intents,
                    });
                } else {
                    throw new Error(`No IntentGroup with name ${this.values.name}`);
                }
            }

            return undefined;
        }

        // otherwise, use an existing IntentGroup id to retrieve the details of an IntentGroup from the chain
        const response = await ExtrinsicHelper.apiPromise.call.schemasRuntimeApi.getIntentGroupById(this.values.id);
        if (response.isEmpty) {
            throw new Error(`No IntentGroup with id ${this.values.id}`);
        }
        const intentGroup = response.unwrap();
        return new IntentGroup({
            id: intentGroup.intentGroupId.toNumber(),
            intents: intentGroup.intentIds.map((intentId) => intentId.toNumber()),
        });
    }

    public async build(creatorKeys: KeyringPair): Promise<IntentGroup> {
        const intentGroup = await this.resolve();
        if (intentGroup) {
            return intentGroup;
        }

        // If no resolved IntentGroup, we're creating a new IntentGroup on-chain
        if ([this.values.name, this.values.intents].some((attr) => attr === undefined)) {
            throw new Error('Missing attribute(s) for IntentGroup creation');
        }

        const [event] = await ExtrinsicHelper.createIntentGroup(creatorKeys, this.values.name!, this.values.intents!).fundAndSend();
        if (!event || !ExtrinsicHelper.api.events.schemas.IntentGroupCreated.is(event)) {
            throw new Error('IntentGroup not created');
        }

        return new IntentGroup({
            id: event.data.intentGroupId.toNumber(),
            name: this.values.name!,
            intents: this.values.intents!,
        });
    }
}
