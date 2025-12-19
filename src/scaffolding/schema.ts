import avsc from 'avsc';
import {IIntent, IntentSettingStr, PayloadLocationStr} from "./intent";

export type ModelTypeStr = 'AvroBinary' | 'Parquet';

export interface ISchema {
  id: number;
  intentId: number;
  model: object;
  modelType: ModelTypeStr;
  payloadLocation: PayloadLocationStr;
  settings?: IntentSettingStr[];
}

export class Schema implements ISchema {
  private readonly _id: number;

  private readonly _intentId: number;

  private readonly _model: any;

  private readonly _modelType: ModelTypeStr;

  private readonly _payloadLocation: PayloadLocationStr;

  private readonly _settings: IntentSettingStr[];

  private _codec: avsc.Type | undefined; // TODO: add ParquetJS support

  constructor(source: ISchema, intent?: IIntent) {
    this._intentId = intent?.id || source.intentId;
    this._model = source.model;
    this._modelType = source.modelType;
    this._payloadLocation = intent?.payloadLocation || source.payloadLocation;
    this._settings = intent?.settings ?? source.settings ?? [];
    this._id = source.id;

    if (this.modelType === 'AvroBinary') {
      const avroModel: avsc.Schema = (() => {
        if (this.model?.toHuman) {
          return JSON.parse(this.model.toHuman());
        }

        if (typeof this._model === 'string') {
          return JSON.parse(this.model);
        }

        return this.model;
      })();

      this._codec = avsc.Type.forSchema(avroModel);
    }
  }

  public get id() {
    return this._id;
  }

  public get intentId() {
    return this._intentId;
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
