"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameRegistry = void 0;
exports.createDefaultGameRegistry = createDefaultGameRegistry;
const senReveal_module_1 = require("./sen-reveal/senReveal.module");
class GameRegistry {
    modules = new Map();
    constructor(modules = []) {
        modules.forEach((module) => this.register(module));
    }
    register(module) {
        if (this.modules.has(module.type)) {
            throw new Error(`Game type '${module.type}' is already registered`);
        }
        this.modules.set(module.type, module);
        return this;
    }
    get(type) {
        return this.modules.get(type);
    }
    types() {
        return [...this.modules.keys()];
    }
}
exports.GameRegistry = GameRegistry;
function createDefaultGameRegistry() {
    return new GameRegistry([senReveal_module_1.senRevealModule]);
}
//# sourceMappingURL=gameRegistry.js.map