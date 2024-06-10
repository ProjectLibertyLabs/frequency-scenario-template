/* eslint-disable no-underscore-dangle */
import { SchemaId } from '@frequency-chain/api-augment/interfaces';

export type ModelTypeStr = 'AvroBinary' | 'Parquet';
export type PayloadLocationStr = 'OnChain' | 'Ipfs' | 'Itemized' | 'Paginated';
export type SchemaSettingStr = 'AppendOnly' | 'SignatureRequired';

export interface ISchema {
  id: SchemaId;
  model: object;
  modelType: ModelTypeStr;
  payloadLocation: PayloadLocationStr;
  settings?: SchemaSettingStr[];
  name?: string;
}

export class Schema implements ISchema {
  private readonly _id: SchemaId;

  private readonly _model: {};

  private readonly _modelType: ModelTypeStr;

  private readonly _payloadLocation: PayloadLocationStr;

  private readonly _settings: SchemaSettingStr[];

  private readonly _name: string | undefined;

  constructor(source: ISchema) {
    this._model = source.model;
    this._modelType = source.modelType;
    this._payloadLocation = source.payloadLocation;
    this._settings = source?.settings ?? [];
    this._id = source.id;
    this._name = source?.name;
  }

  public get id() {
    return this._id;
  }

  public get model() {
    return this._model;
  }

  public get modelType() {
    return this._modelType;
  }

  public get payloadLocation() {
    return this._payloadLocation;
  }

  public get settings() {
    return this._settings;
  }

  public get name() {
    return this?._name;
  }
}
