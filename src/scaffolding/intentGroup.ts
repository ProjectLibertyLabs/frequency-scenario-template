export interface IIntentGroup {
  id: number;
  name?: string;
  intents: number[];
}

export class IntentGroup implements IIntentGroup {
  private readonly _id: number;

  private readonly _name: string | undefined;

  private readonly _intents: number[];

  constructor(source: IIntentGroup) {
    this._name = source.name;
    this._intents = [...source.intents];
    this._id = source.id;
  }

  public get id() {
    return this._id;
  }

  public get name() {
    return this._name;
  }

  public get intents() {
    return this._intents;
  }
}
