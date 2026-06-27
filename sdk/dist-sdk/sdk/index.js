"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLiatirAvailable = exports.Liatir = void 0;
// Main SDK entry: typed proxy over window.Liatir
var _proxy_1 = require("./_proxy");
Object.defineProperty(exports, "Liatir", { enumerable: true, get: function () { return _proxy_1.Liatir; } });
Object.defineProperty(exports, "isLiatirAvailable", { enumerable: true, get: function () { return _proxy_1.isLiatirAvailable; } });
