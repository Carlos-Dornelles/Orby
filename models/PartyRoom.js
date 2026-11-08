import mongoose from "mongoose";

export const PARTY_MAX_USERS = 8;
export const PARTY_ROOM_ICONS = Object.freeze([
  "🎮", "🎲", "🏆", "🎉", "🎯", "🧩", "🕹️", "👾",
  "🚀", "⭐", "🎨", "🎵", "⚽", "🍕", "🌙", "🔥"
]);

const participantSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  username: { type: String, required: true, trim: true, maxlength: 100 },
  joinedAt: { type: Date, required: true, default: Date.now }
}, { _id: false });

const partyGameSchema = new mongoose.Schema({
  id: { type: String, required: true, trim: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  enabled: { type: Boolean, default: false }
}, { _id: false });

const partyConfigSchema = new mongoose.Schema({
  name: { type: String, trim: true, maxlength: 100, default: "" },
  games: { type: [partyGameSchema], default: [] },
  rounds: { type: Number, min: 0, max: 100, default: 0 }
}, { _id: false });

const partyScoreSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  username: { type: String, required: true, trim: true, maxlength: 100 },
  totalPoints: { type: Number, required: true, min: 0, default: 0 }
}, { _id: false });

const gameRankingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  username: { type: String, required: true, trim: true, maxlength: 100 },
  points: { type: Number, required: true, min: 0, default: 0 },
  position: { type: Number, required: true, min: 1 }
}, { _id: false });

const gameResultSchema = new mongoose.Schema({
  gameId: { type: String, required: true, trim: true, maxlength: 80 },
  gameName: { type: String, required: true, trim: true, maxlength: 120 },
  rankings: { type: [gameRankingSchema], default: [] },
  finishedAt: { type: Date, required: true }
}, { _id: false });

const currentPartySchema = new mongoose.Schema({
  id: { type: String, required: true },
  status: {
    type: String,
    enum: ["party_running", "showing_game_results", "showing_final_results"],
    required: true
  },
  currentGameIndex: { type: Number, min: 0, required: true },
  selectedGames: { type: [partyGameSchema], default: [] },
  gameState: { type: mongoose.Schema.Types.Mixed, default: null },
  gameStateVersion: { type: Number, min: 0, default: 0 },
  leftUserIds: { type: [String], default: [] },
  roundFinishAt: { type: Date, default: null },
  scores: { type: [partyScoreSchema], default: [] },
  gameResults: { type: [gameResultSchema], default: [] },
  startedAt: { type: Date, required: true },
  currentGameStartedAt: { type: Date, default: null },
  phaseEndsAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null }
}, { _id: false });

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  coverPublicId: { type: String, trim: true, maxlength: 180, default: "" },
  roomIcon: { type: String, enum: PARTY_ROOM_ICONS, default: "🎮" },
  hostId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  participants: { type: [participantSchema], default: [] },
  maxUsers: { type: Number, immutable: true, default: PARTY_MAX_USERS, min: PARTY_MAX_USERS, max: PARTY_MAX_USERS },
  status: { type: String, enum: ["waiting", "started"], default: "waiting", index: true },
  state: {
    type: String,
    enum: ["waiting", "party_running", "showing_game_results", "showing_final_results"],
    default: "waiting",
    index: true
  },
  currentParty: { type: currentPartySchema, default: null },
  partyConfig: { type: partyConfigSchema, default: () => ({}) }
}, { collection: "PARTY_ROOMS", timestamps: true });

roomSchema.index({ state: 1, updatedAt: -1 });
roomSchema.index({ "participants.userId": 1 });

export const PartyRoom = mongoose.models.PartyRoom || mongoose.model("PartyRoom", roomSchema);

const partyMessageSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderName: { type: String, required: true, trim: true, maxlength: 100 },
  type: { type: String, enum: ["text", "image", "party-result"], default: "text" },
  text: { type: String, trim: true, maxlength: 500, default: "" },
  imageUrl: { type: String, trim: true, maxlength: 1000, default: "" },
  ranking: { type: [gameRankingSchema], default: undefined },
  createdAt: { type: Date, required: true, default: Date.now }
}, { collection: "PARTY_ROOM_MESSAGES", versionKey: false });

partyMessageSchema.index({ roomId: 1, createdAt: -1 });
export const PartyRoomMessage = mongoose.models.PartyRoomMessage || mongoose.model("PartyRoomMessage", partyMessageSchema);
