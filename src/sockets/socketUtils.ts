import { logError } from "../logger.ts";
import { SCOPE } from "../globals.ts";

declare const socketlib: any;

export class SocketUtils {
    private static _socket: any = null;

    static get socket(): any {
        return this._socket;
    }

    static set socket(val: any) {
        this._socket = val;
    }

    static initSocketlib(): any {
        if (typeof socketlib === "undefined") {
            logError("socketlib not found! Multi-user synchronization will be disabled.");
            return null;
        }
        // @ts-ignore
        this._socket = socketlib.registerModule(SCOPE);
        return this._socket;
    }
}
