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
__exportStar(require("./core/_main"), exports);
__exportStar(require("./desktopr/_main"), exports);
__exportStar(require("./modules/rs/files/_main"), exports);
__exportStar(require("./modules/rs/events/_main"), exports);
__exportStar(require("./modules/rs/fs/_main"), exports);
__exportStar(require("./modules/rs/clipboard/_main"), exports);
__exportStar(require("./modules/rs/shortcuts/_main"), exports);
__exportStar(require("./modules/rs/notifications/_main"), exports);
__exportStar(require("./modules/rs/app/_main"), exports);
__exportStar(require("./modules/rs/window/_main"), exports);
__exportStar(require("./modules/rs/dragdrop/_main"), exports);
__exportStar(require("./modules/rs/menu/_main"), exports);
__exportStar(require("./modules/rs/diagnostics/_main"), exports);
__exportStar(require("./modules/rs/network/_main"), exports);
__exportStar(require("./modules/rs/autostart/_main"), exports);
__exportStar(require("./modules/rs/badge/_main"), exports);
__exportStar(require("./modules/rs/worker/_main"), exports);
__exportStar(require("./modules/rs/contextMenu/_main"), exports);
__exportStar(require("./modules/rs/companion/_main"), exports);
__exportStar(require("./modules/rs/globalVariables/_main"), exports);
