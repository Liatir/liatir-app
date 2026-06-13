"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./core/_types"), exports);
__exportStar(require("./desktopr/_types"), exports);
__exportStar(require("./modules/rs/files/_types"), exports);
__exportStar(require("./modules/rs/events/_types"), exports);
__exportStar(require("./modules/rs/fs/_types"), exports);
__exportStar(require("./modules/rs/clipboard/_types"), exports);
__exportStar(require("./modules/rs/shortcuts/_types"), exports);
__exportStar(require("./modules/rs/notifications/_types"), exports);
__exportStar(require("./modules/rs/app/_types"), exports);
__exportStar(require("./modules/rs/window/_types"), exports);
__exportStar(require("./modules/rs/dragdrop/_types"), exports);
__exportStar(require("./modules/rs/diagnostics/_types"), exports);
__exportStar(require("./modules/rs/menu/_types"), exports);
__exportStar(require("./modules/rs/autostart/_types"), exports);
__exportStar(require("./modules/rs/badge/_types"), exports);
__exportStar(require("./modules/rs/worker/_types"), exports);
__exportStar(require("./modules/rs/contextMenu/_types"), exports);
__exportStar(require("./modules/rs/companion/_types"), exports);
__exportStar(require("./modules/rs/globalVariables/_types"), exports);
