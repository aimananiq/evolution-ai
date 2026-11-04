"use client";
import { io as createSocket, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = createSocket({
    path: "/socket.io",
    autoConnect: true,
    withCredentials: true,
  });
  return socket;
}
