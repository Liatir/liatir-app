"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROWSER_STORAGE_NAMESPACE = exports.WINDOWS_LABELS_TRACKER_VARIABLE_NAME = exports.READY_EVENT_NAME = exports.COMAPNION_WINDOW_LABEL_PREFIX = exports.API_VERSION = exports.APP_URL = void 0;
const bridge_constants_json_1 = __importDefault(require("./bridge.constants.json"));
exports.APP_URL = bridge_constants_json_1.default.appUrl;
exports.API_VERSION = bridge_constants_json_1.default.apiVersion;
exports.COMAPNION_WINDOW_LABEL_PREFIX = bridge_constants_json_1.default.companionWindowLabelPrefix;
exports.READY_EVENT_NAME = "dtrReady";
exports.WINDOWS_LABELS_TRACKER_VARIABLE_NAME = "open-windows-labels-tracker-rpkw6kjzxn8bfhj5u74q";
exports.BROWSER_STORAGE_NAMESPACE = "dtr_xam8wknpz1vf";
