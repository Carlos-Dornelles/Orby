import mongoose from "mongoose";

const rankingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  username: { type: String, required: true, trim: true, maxlength: 100 },
  points: { type: Number, required: true, min: 0 },
  position: { type: Number, required: true, min: 1 }
}, { _id: false });

const gameResultSchema = new mongoose.Schema({
  gameId: { type: String, required: true, trim: true, maxlength: 80 },
  gameName: { type: String, required: true, trim: true, maxlength: 120 },
  rankings: { type: [rankingSchema], default: [] },
  finishedAt: { type: Date, required: true }
}, { _id: false });

const scoreSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  username: { type: String, required: true, trim: true, maxlength: 100 },
  totalPoints: { type: Number, required: true, min: 0 }
}, { _id: false });

const partySessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  roomId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  status: {
    type: String,
    enum: ["party_running", "showing_game_results", "showing_final_results", "ended"],
    required: true
  },
  currentGameIndex: { type: Number, min: 0, required: true },
  gameStateVersion: { type: Number, min: 0, default: 0 },
  roundFinishAt: { type: Date, default: null },
  selectedGames: { type: [{ id: String, name: String, enabled: Boolean }], default: [] },
  gameResults: { type: [gameResultSchema], default: [] },
  scores: { type: [scoreSchema], default: [] },
  startedAt: { type: Date, required: true },
  currentGameStartedAt: { type: Date, default: null },
  phaseEndsAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null }
}, { collection: "PARTY_SESSIONS", versionKey: false });

export const PartySession = mongoose.models.PartySession ||
  mongoose.model("PartySession", partySessionSchema);
