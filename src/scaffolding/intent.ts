export type PayloadLocationStr = 'OnChain' | 'Ipfs' | 'Itemized' | 'Paginated';
export type IntentSettingStr = 'AppendOnly' | 'SignatureRequired';

export interface IIntent {
  id: number;
  name?: string;
  payloadLocation: PayloadLocationStr;
  settings: IntentSettingStr[];
  schemas?: number[];
}

export class Intent implements IIntent {
  private readonly _id: number;

  private readonly _name: string;

  private readonly _payloadLocation: PayloadLocationStr;

  private readonly _settings: IntentSettingStr[];

  private readonly _schemas?: number[];

  constructor(source: IIntent) {
    this._payloadLocation = source.payloadLocation;
    this._settings = source.settings ?? [];
    this._id = source.id;
  }

  public get id() {
    return this._id;
  }

  public get name() {
    return this._name;
  }

  public get payloadLocation() {
    return this._payloadLocation;
  }

  public get settings() {
    return this._settings;
  }

  public get schemas() {
    return this._schemas;
  }

  public get latestSchema() {
    return this._schemas && this._schemas.length > 0 ? this._schemas[this._schemas.length - 1] : undefined;
  }
}
