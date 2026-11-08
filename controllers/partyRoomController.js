import { PartyRoomError } from "../services/partyRoomService.js";

export function createPartyRoomController({ service, getAuthenticatedUserId }) {
  const execute = handler => async (req, res, next) => {
    try { await handler(req, res); } catch (error) {
      if (error instanceof PartyRoomError) return res.status(error.status).json({ erro: error.message });
      next(error);
    }
  };
  const currentUser = req => {
    const userId = getAuthenticatedUserId(req);
    if (!userId) throw new PartyRoomError("Faça login para usar as Party Rooms.", 401);
    return userId;
  };
  return {
    list: execute(async (_req, res) => res.json(await service.list())),
    get: execute(async (req, res) => res.json(await service.get(req.params.roomId))),
    messages: execute(async (req, res) => res.json(await service.messages(req.params.roomId, currentUser(req))))
  };
}
