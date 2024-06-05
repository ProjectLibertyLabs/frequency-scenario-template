/* eslint-disable no-underscore-dangle */
import { SchemaId } from '@frequency-chain/api-augment/interfaces';
import { Type as AvroType, Schema as AvroSchema } from 'avsc';

export type ModelTypeStr = 'AvroBinary' | 'Parquet';
export type PayloadLocationStr = 'OnChain' | 'Ipfs' | 'Itemized' | 'Paginated';
export type SchemaSettingStr = 'AppendOnly' | 'SignatureRequired';

export class Schema {
  private _id: SchemaId;

  private _model: any;

  private _modelType: ModelTypeStr;

  private _payloadLocation: PayloadLocationStr;

  private _settings: SchemaSettingStr[];

  private _codec: AvroType | undefined; // TODO: add ParquetJS support

  constructor(id: SchemaId, model: any, modelType: ModelTypeStr, payloadLocation: PayloadLocationStr, settings?: SchemaSettingStr[]) {
    this._model = model;
    this._modelType = modelType;
    this._payloadLocation = payloadLocation;
    this._settings = settings ?? [];
    this._id = id;

    if (this.modelType === 'AvroBinary') {
      const avroModel: AvroSchema = (() => {
        if (this.model?.toHuman) {
          return JSON.parse(this.model.toHuman());
        }

        if (typeof this._model === 'string') {
          return JSON.parse(this.model);
        }

        return this.model;
      })();

      this._codec = AvroType.forSchema(avroModel);
    }
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

  public fromBuffer(val: any) {
    if (this.modelType === 'AvroBinary' && this._codec?.fromBuffer) {
      return this._codec.fromBuffer(val);
    }

    return undefined;
  }

  public toBuffer(val: any) {
    if (this.modelType === 'AvroBinary' && this._codec?.toBuffer) {
      return this._codec.toBuffer(val);
    }

    return undefined;
  }
}
