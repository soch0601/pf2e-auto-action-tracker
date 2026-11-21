import { SocketUtils } from "./socketUtils.ts";
import { SocketSender } from "./SocketSender.ts";
import { SocketReceiver } from "./SocketReceiver.ts";

export { SocketUtils, SocketSender, SocketReceiver };

export class SocketsManager {
    static get socket() {
        return SocketUtils.socket;
    }

    static set socket(val: any) {
        SocketUtils.socket = val;
    }

    static initSockets() {
        const socket = SocketUtils.initSocketlib();
        if (socket) {
            SocketReceiver.initHandlers(socket);
        }
    }
}
