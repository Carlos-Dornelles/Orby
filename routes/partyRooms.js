import { Router } from "express";

export function createPartyRoomRouter(controller) {
  const router = Router();
  router.get("/", controller.list);
  router.get("/:roomId", controller.get);
  router.get("/:roomId/messages", controller.messages);
  return router;
}
