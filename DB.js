import "dotenv/config";
import { setServers } from "node:dns";
import mongoose from "mongoose";

export default async function connectDB() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("MONGODB_URI não foi definida. Configure o arquivo .env.");
  }

  if (uri.startsWith("mongodb+srv://")) {
    const dnsServers = (process.env.MONGODB_DNS_SERVERS || "1.1.1.1,8.8.8.8")
      .split(",")
      .map(server => server.trim())
      .filter(Boolean);

    if (dnsServers.length === 0) {
      throw new Error("MONGODB_DNS_SERVERS deve conter pelo menos um endereço DNS.");
    }

    try {
      setServers(dnsServers);
    } catch (error) {
      throw new Error(`MONGODB_DNS_SERVERS inválido: ${error.message}`);
    }
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log("MongoDB conectado com sucesso.");
}
