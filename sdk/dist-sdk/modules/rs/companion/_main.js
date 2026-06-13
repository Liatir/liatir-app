"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCompanion = buildCompanion;
const helpers_1 = require("../../../helpers");
function buildCompanion(core) {
    return {
        launch: (appConfig) => (0, helpers_1.launchCompanion)(core, appConfig),
        state: {}
    };
}
