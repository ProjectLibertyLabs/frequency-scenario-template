import '@frequency-chain/api-augment';
import { KeyringPair } from '@polkadot/keyring/types';

type CTor = new (...args: any[]) => any;
type BuilderCTor<IFace, Self> = new (arg: IFace) => Self;
type ArrayProp<T, K extends keyof T> = Extract<NonNullable<T[K]>, readonly unknown[]>;
type ArrayElem<T, K extends keyof T> = NonNullable<T[K]> extends readonly (infer U)[] ? U : never;
type ArrayKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly unknown[] ? K : never;
}[keyof T];

export interface BuilderIFace {
  id?: any;
}

export interface BuilderWithNameIFace extends BuilderIFace {
  name?: string;
}

export abstract class Builder<IFace extends BuilderIFace, ClassType extends CTor> {
  protected values: IFace = {} as IFace;

  constructor(values?: IFace) {
    if (values) {
      Object.assign(this.values, values);
    }
  }

  protected propertySetter<K extends keyof IFace>(key: K) {
    return (value: IFace[K]) => this.withProperty(key, value);
  }

  protected arrayPropertyAppender<K extends ArrayKeys<IFace>>(key: K) {
    return (value: ArrayElem<IFace, K>) => this.withAppendArrayProperty(key, value);
  }

  protected withProperty<K extends keyof IFace>(propertyName: K, value: IFace[K]): this {
    const ctor = this.constructor as BuilderCTor<IFace, this>;
    return new ctor({ ...this.values, id: undefined, [propertyName]: value });
  }

  protected withAppendArrayProperty<K extends ArrayKeys<IFace>>(propertyName: K, value: ArrayElem<IFace, K>): this {
    const ctor = this.constructor as BuilderCTor<IFace, this>;
    const current = (this.values[propertyName] ?? []) as unknown as ArrayProp<IFace, K>;

    return new ctor({ ...this.values, id: undefined, [propertyName]: [...current, value] });
  }

  public abstract resolve(): Promise<InstanceType<ClassType> | undefined>;
  public abstract build(creatorKeys: KeyringPair): Promise<InstanceType<ClassType>>;
}

export abstract class BuilderWithName<IFace extends BuilderWithNameIFace, ClassType extends CTor> extends Builder<IFace, ClassType> {
  public withName(protocolName: string, descriptorName: string): this {
    return this.withProperty('name', `${protocolName}.${descriptorName}`);
  }
}
