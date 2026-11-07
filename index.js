// THE OUTCASTS | OLYMPUS LEGACY
// Discord.js v14 + authenticated attendance API for the Signup Bot.
// Required: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, LEGACY_API_KEY
// Optional: DATA_DIR=/data, PORT=3000
// Node.js 18+ required (native fetch).

const {
  Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes,
  EmbedBuilder, PermissionFlagsBits
} = require("discord.js");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.LEGACY_API_KEY;
const DATA_DIR = process.env.DATA_DIR || "/data";
const PORT = Number(process.env.PORT || 3000);
if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_KEY) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID, GUILD_ID or LEGACY_API_KEY.");
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, "olympus-legacy.json");

function loadDB() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return {
      members: parsed.members || {},
      events: parsed.events || {},
      rewards: parsed.rewards || [],
      transactions: parsed.transactions || []
    };
  } catch {
    return { members: {}, events: {}, rewards: [], transactions: [] };
  }
}
const db = loadDB();
function saveDB() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function member(id) {
  if (!db.members[id]) db.members[id] = { coins: 0, reputation: 0, achievements: [], attended: 0, highestRankIndex: 0, lifetimeCoinsEarned: 0 };
  return db.members[id];
}
const RANKS = [
  { name: "Mortal", threshold: 0, roleId: "1568649500787085362", display: "🥉 Mortal" },
  { name: "Faithful", threshold: 250, roleId: "1568649593539919993", display: "🥈 Faithful" },
  { name: "Olympian", threshold: 750, roleId: "1568649665052807398", display: "🥇 Olympian" },
  { name: "Champion", threshold: 1500, roleId: "1568649722166640740", display: "⚔️ Champion" },
  { name: "Demigod", threshold: 3000, roleId: "1568649794413527100", display: "👑 Demigod" },
  { name: "Eternal Legend", threshold: 5000, roleId: "1568649946830348359", display: "⚡ Eternal Legend" }
];
function rankIndex(rep) {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (rep >= RANKS[i].threshold) index = i;
  return index;
}
function rank(rep) { return RANKS[rankIndex(rep)].display; }
async function syncRankRole(guildId, userId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const guildMember = await guild.members.fetch(userId);
    const m = member(userId);
    const earnedIndex = rankIndex(m.reputation);
    const previousIndex = Number.isInteger(m.highestRankIndex) ? m.highestRankIndex : 0;
    const targetIndex = Math.max(previousIndex, earnedIndex);
    m.highestRankIndex = targetIndex;
    const targetRoleId = RANKS[targetIndex].roleId;
    const oldRankRoleIds = RANKS.filter(r => r.roleId !== targetRoleId).map(r => r.roleId);
    const removeIds = oldRankRoleIds.filter(id => guildMember.roles.cache.has(id));
    if (removeIds.length) await guildMember.roles.remove(removeIds, "Olympus Legacy rank progression");
    if (!guildMember.roles.cache.has(targetRoleId)) await guildMember.roles.add(targetRoleId, "Olympus Legacy rank progression");
    saveDB();
    return RANKS[targetIndex].name;
  } catch (err) {
    console.error(`[Olympus Legacy] Could not sync rank role for ${userId} in ${guildId}:`, err.message);
    return null;
  }
}
function updateAchievements(m) {
  const earned = [
    [m.attended >= 1, "First Steps"],
    [m.attended >= 5, "Loyal Soul"],
    [m.attended >= 10, "Devoted Member"],
    [m.attended >= 25, "Olympian"],
    [m.attended >= 50, "Legendary"],
    [m.attended >= 100, "Eternal Legend"],
    [(m.lifetimeCoinsEarned || 0) >= 1000, "Wealth of Olympus"],
    [(m.lifetimeCoinsEarned || 0) >= 5000, "Treasury Keeper"]
  ];
  const newlyUnlocked = [];
  for (const [condition, name] of earned) {
    if (condition && !m.achievements.includes(name)) {
      m.achievements.push(name);
      newlyUnlocked.push(name);
    }
  }
  return newlyUnlocked;
}
const ACHIEVEMENT_CHANNEL_ID = "1568652450917916794";
async function announceAchievements(userId, achievementNames) {
  if (!achievementNames || !achievementNames.length) return;
  try {
    const channel = await client.channels.fetch(ACHIEVEMENT_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error(`[Olympus Legacy] Achievement channel ${ACHIEVEMENT_CHANNEL_ID} is unavailable or not text-based.`);
      return;
    }
    const memberUser = await client.users.fetch(userId);
    const descriptions = {
      "First Steps": "You've attended your first party and begun your Olympus journey.",
      "Loyal Soul": "Five parties attended. Your loyalty is becoming known throughout Olympus.",
      "Devoted Member": "Ten parties attended. Your dedication to The Outcasts shines.",
      "Olympian": "Twenty-five parties attended. You are among Olympus's devoted.",
      "Legendary": "Fifty parties attended. Your name is becoming legendary.",
      "Eternal Legend": "One hundred parties attended. Your legacy will not be forgotten.",
      "Wealth of Olympus": "You've earned 1,000 Olympus Coins over your journey.",
      "Treasury Keeper": "You've earned 5,000 Olympus Coins over your journey."
    };
    const embeds = achievementNames.map(name => new EmbedBuilder()
      .setColor(0xC9A646)
      .setTitle("🏛️ A NEW LEGEND IS RISING!")
      .setDescription(`Congratulations <@${userId}>!

You've unlocked **${name}**.
${descriptions[name] || "A new achievement has been added to your Olympus Legacy."}`)
      .setFooter({ text: "THE OUTCASTS • OLYMPUS LEGACY | Recognition earned, never purchased." })
      .setTimestamp());
    for (const embed of embeds) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`[Olympus Legacy] Could not announce achievement for ${userId}:`, err.message);
  }
}
function logTransaction(userId, coins, reputation, reason, actorId) {
  const m = member(userId);
  m.coins = Math.max(0, m.coins + coins);
  m.reputation = Math.max(0, m.reputation + reputation);
  if (coins > 0) m.lifetimeCoinsEarned = (m.lifetimeCoinsEarned || 0) + coins;
  const newlyUnlocked = updateAchievements(m);
  if (newlyUnlocked.length) void announceAchievements(userId, newlyUnlocked);
  db.transactions.unshift({ userId, coins, reputation, reason, actorId, at: new Date().toISOString() });
  db.transactions = db.transactions.slice(0, 5000);
  saveDB();
}
function rewardFor(eventType) {
  return String(eventType).toLowerCase().includes("1k")
    ? { coins: 30, reputation: 30 }
    : { coins: 10, reputation: 10 };
}
function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}
const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/attendance/confirm") return json(res, 404, { error: "Not found" });
  if (req.headers.authorization !== `Bearer ${API_KEY}`) return json(res, 401, { error: "Unauthorized" });
  let raw = "";
  req.on("data", chunk => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); });
  req.on("end", async () => {
    try {
      const body = JSON.parse(raw || "{}");
      const { eventId, guildId, eventName, eventType, hostId, coHostId, confirmedBy, attendees } = body;
      if (!eventId || guildId !== GUILD_ID || !Array.isArray(attendees) || !attendees.length) return json(res, 400, { error: "Invalid attendance payload." });
      if (![hostId, coHostId].includes(confirmedBy)) return json(res, 403, { error: "Only the event host or co-host can confirm attendance." });
      if (db.events[eventId]) return json(res, 409, { error: "Rewards have already been issued for this event.", awarded: 0 });
      const unique = [...new Map(attendees.filter(a => /^\d{17,20}$/.test(String(a.userId || ""))).map(a => [String(a.userId), a])).values()];
      if (!unique.length) return json(res, 400, { error: "No valid Discord member IDs were supplied." });
      const amount = rewardFor(eventType);
      for (const attendee of unique) {
        logTransaction(String(attendee.userId), amount.coins, amount.reputation, `Attendance: ${eventName || eventType}`, confirmedBy);
        const m = member(String(attendee.userId));
        m.attended += 1;
        const newlyUnlocked = updateAchievements(m);
        await announceAchievements(String(attendee.userId), newlyUnlocked);
        await syncRankRole(guildId, String(attendee.userId));
      }
      db.events[eventId] = { eventName, eventType, guildId, confirmedBy, awarded: unique.length, rewards: amount, at: new Date().toISOString() };
      saveDB();
      return json(res, 200, { ok: true, awarded: unique.length, ...amount });
    } catch (err) {
      console.error("Attendance API error:", err);
      return json(res, 400, { error: "Invalid JSON or attendance request." });
    }
  });
});

const commands = [
  new SlashCommandBuilder().setName("balance").setDescription("Check your Olympus Coins."),
  new SlashCommandBuilder().setName("reputation").setDescription("View your Olympus rank and reputation.")
    .addUserOption(o => o.setName("member").setDescription("Member to view").setRequired(false)),
  new SlashCommandBuilder().setName("shop").setDescription("Browse Olympus Legacy rewards."),
  new SlashCommandBuilder().setName("leaderboard").setDescription("View the Olympus Legacy leaderboard."),
  new SlashCommandBuilder().setName("achievements").setDescription("View your unlocked Olympus achievements."),
  new SlashCommandBuilder().setName("coins-add").setDescription("Award coins and reputation manually.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName("member").setDescription("Member to reward").setRequired(true))
    .addIntegerOption(o => o.setName("coins").setDescription("Coins to award").setMinValue(0).setMaxValue(100000).setRequired(true))
    .addIntegerOption(o => o.setName("reputation").setDescription("Reputation to award").setMinValue(0).setMaxValue(100000).setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the award").setMaxLength(150).setRequired(true)),
  new SlashCommandBuilder().setName("coins-remove").setDescription("Remove coins and reputation manually.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName("member").setDescription("Member to adjust").setRequired(true))
    .addIntegerOption(o => o.setName("coins").setDescription("Coins to remove").setMinValue(0).setMaxValue(100000).setRequired(true))
    .addIntegerOption(o => o.setName("reputation").setDescription("Reputation to remove").setMinValue(0).setMaxValue(100000).setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the adjustment").setMaxLength(150).setRequired(true)),
  new SlashCommandBuilder().setName("legacy-stats").setDescription("View Olympus Legacy system statistics.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("ready", async () => {
  console.log(`🏛️ Olympus Legacy online as ${client.user.tag}`);
  server.listen(PORT, "0.0.0.0", () => console.log(`Olympus Legacy API listening on ${PORT}`));
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Olympus Legacy slash commands registered.");
  } catch (err) { console.error("Slash command registration failed:", err); }
});
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;
  try {
    if (i.commandName === "balance") {
      const m = member(i.user.id);
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xC9A646).setTitle("🏛️ YOUR OLYMPUS TREASURY").setDescription(`💰 **Olympus Coins:** ${m.coins.toLocaleString()}\n⭐ **Reputation:** ${m.reputation.toLocaleString()}\n⚔️ **Rank:** ${rank(m.reputation)}`).setFooter({ text: "THE OUTCASTS • OLYMPUS LEGACY" })], ephemeral: true });
    }
    if (i.commandName === "reputation") {
      const u = i.options.getUser("member") || i.user, m = member(u.id);
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xC9A646).setTitle(`⚔️ ${u.username}'S LEGACY`).setDescription(`**Rank:** ${rank(m.reputation)}\n**Reputation:** ${m.reputation.toLocaleString()}\n**Parties attended:** ${m.attended}\n**Next rank:** ${m.reputation < 250 ? 250 : m.reputation < 750 ? 750 : m.reputation < 1500 ? 1500 : m.reputation < 3000 ? 3000 : m.reputation < 5000 ? 5000 : "Maximum rank"}`).setThumbnail(u.displayAvatarURL()).setFooter({ text: "THE OUTCASTS • OLYMPUS LEGACY" })], ephemeral: true });
    }
    if (i.commandName === "shop") {
      const list = db.rewards.length ? db.rewards.map(r => `**${r.name}** — ${r.cost} coins\n${r.description}`).join("\n\n") : "The Olympus shop is being prepared. New rewards will be announced soon.";
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xC9A646).setTitle("🎁 THE OLYMPUS REWARDS SHOP").setDescription(list).setFooter({ text: "Purchases and reward fulfilment will be enabled in a later shop release." })], ephemeral: true });
    }
    if (i.commandName === "leaderboard") {
      const top = Object.entries(db.members).sort((a,b) => b[1].reputation - a[1].reputation).slice(0,10);
      const desc = top.length ? top.map(([id,m],n) => `**${n+1}.** <@${id}> — ${m.reputation} reputation • ${m.coins} coins`).join("\n") : "No legacy records yet. Attend a party to begin your journey!";
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xC9A646).setTitle("🏆 HALL OF LEGENDS").setDescription(desc).setFooter({ text: "Ranked by reputation" })] });
    }
    if (i.commandName === "achievements") {
      const m = member(i.user.id);
      const list = m.achievements.length ? m.achievements.map(a => `🏅 ${a}`).join("\n") : "No achievements unlocked yet. Your legacy starts with your first party!";
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xC9A646).setTitle("🏺 YOUR ACHIEVEMENTS").setDescription(list)], ephemeral: true });
    }
    if (i.commandName === "coins-add" || i.commandName === "coins-remove") {
      const u = i.options.getUser("member"), c = i.options.getInteger("coins"), r = i.options.getInteger("reputation"), reason = i.options.getString("reason");
      const sign = i.commandName === "coins-add" ? 1 : -1;
      logTransaction(u.id, c*sign, r*sign, reason, i.user.id);
      await syncRankRole(i.guildId || GUILD_ID, u.id);
      return i.reply({ content: `🏛️ Updated <@${u.id}>: ${c*sign} coins and ${r*sign} reputation. Reason: ${reason}`, ephemeral: true });
    }
    if (i.commandName === "legacy-stats") {
      const totalCoins = Object.values(db.members).reduce((n,m)=>n+m.coins,0);
      const totalRep = Object.values(db.members).reduce((n,m)=>n+m.reputation,0);
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xC9A646).setTitle("🏛️ OLYMPUS LEGACY | SYSTEM STATISTICS").setDescription(`**Registered members:** ${Object.keys(db.members).length}\n**Events rewarded:** ${Object.keys(db.events).length}\n**Total coins in circulation:** ${totalCoins.toLocaleString()}\n**Total reputation:** ${totalRep.toLocaleString()}\n**Transactions recorded:** ${db.transactions.length}`)], ephemeral: true });
    }
  } catch (err) {
    console.error("Legacy command error:", err);
    const payload = { content: "Something went wrong. Please try again.", ephemeral: true };
    if (i.deferred || i.replied) await i.followUp(payload).catch(()=>{});
    else await i.reply(payload).catch(()=>{});
  }
});
client.login(TOKEN);
