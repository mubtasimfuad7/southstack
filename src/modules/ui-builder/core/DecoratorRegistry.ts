import { BaseDecorator } from './DesignNode';
import { BackgroundDecorator } from './decorators/BackgroundDecorator';
import { LayoutDecorator } from './decorators/LayoutDecorator';
import { TextColorDecorator, TextAlignDecorator } from './decorators/TextDecorators';

class DecoratorRegistryImpl {
  private decorators: Map<string, BaseDecorator> = new Map();

  constructor() {
    this.register(new BackgroundDecorator());
    this.register(new LayoutDecorator());
    this.register(new TextColorDecorator());
    this.register(new TextAlignDecorator());
  }

  register(decorator: BaseDecorator) {
    this.decorators.set(decorator.type, decorator);
  }

  get(type: string): BaseDecorator | undefined {
    return this.decorators.get(type);
  }
}

export const DecoratorRegistry = new DecoratorRegistryImpl();
