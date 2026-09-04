const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    PermissionFlagsBits,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

// --- RAILWAY DEĞİŞKENLERİ ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const WAITLIST_ROLE_ID = process.env.WAITLIST_ROLE_ID || "1545489606244302899";
const BOOSTER_ROLE_ID = process.env.BOOSTER_ROLE_ID || "1530296291152760905";
const TESTER_ROLE_ID = process.env.TESTER_ROLE_ID || "1530296291152760905";
const TEST_LOG_CHANNEL_ID = process.env.TEST_LOG_CHANNEL_ID || "1545491558458064966";

const MAX_QUEUE_CAPACITY = 20;
const NORMAL_COOLDOWN = 5 * 24 * 60 * 60 * 1000; // 5 Gün
const BOOSTER_COOLDOWN = 2 * 24 * 60 * 60 * 1000; // 2 Gün

// Hafıza (State)
const queueData = {
    isOpen: false,
    activeTesters: new Set(),
    queue: []
};

const cooldowns = new Map();
const userFormData = new Map(); // userId -> { mcNick, serverIp, isPremium }

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- HELPER: MINECRAFT SKIN URL ---
function getMcSkinUrl(username, isPremium) {
    if (isPremium && username) {
        return `https://crafatar.com/renders/head/${encodeURIComponent(username)}?overlay=true`;
    }
    return "https://crafatar.com/renders/head/8667ba71-b85a-4004-af54-457a973daf31?overlay=true";
}

// --- EMBED OLUŞTURUCU ---
function createQueueEmbed(guild) {
    const isOpen = queueData.isOpen;
    const queueCount = queueData.queue.length;
    const percentage = Math.floor((queueCount / MAX_QUEUE_CAPACITY) * 100);

    const filledBlocks = Math.floor((queueCount / MAX_QUEUE_CAPACITY) * 10);
    const progressBar = "█".repeat(filledBlocks) + "▒".repeat(10 - filledBlocks);

    const color = isOpen ? 0x2ECC71 : 0xE74C3C;
    const statusStr = isOpen ? "🟢 AÇIK" : "🔴 KAPALI";

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: "www.trtier.com", iconURL: guild?.iconURL() || undefined })
        .setTitle("🛡️ Smp Test Sırası")
        .addFields(
            {
                name: "🗡️ Sıra Durumu",
                value: `\`\`\`\n┌─── ℹ️ Durum Bilgisi ───┐\n│ Durum: ${statusStr}\n│ Doluluk: [${progressBar}] ${queueCount}/${MAX_QUEUE_CAPACITY} (${percentage}%)\n│ Sıra: ${queueCount} / ${MAX_QUEUE_CAPACITY}\n└──────────────────────────┘\n\`\`\``,
                inline: false
            },
            {
                name: `🏆 Aktif Testerlar (${queueData.activeTesters.size})`,
                value: queueData.activeTesters.size > 0 
                    ? Array.from(queueData.activeTesters).map(id => `<@${id}>`).join("\n")
                    : "`Henüz aktif tester yok`",
                inline: false
            }
        );

    let queueListStr = "`Sırada kimse yok - İlk sen ol!`";
    if (queueData.queue.length > 0) {
        queueListStr = queueData.queue.map((userId, index) => {
            const member = guild.members.cache.get(userId);
            const isBooster = member && member.roles.cache.has(BOOSTER_ROLE_ID);
            const boosterIcon = isBooster ? "⭐" : "";
            const num = (index + 1).toString().padStart(2, '0');
            return `\`${num}.\` <@${userId}> ${boosterIcon}`;
        }).join("\n");
    }

    embed.addFields({
        name: `👥 Sıradaki Oyuncular (${queueCount} Kişi)\n📋 Sıra Listesi`,
        value: queueListStr,
        inline: false
    });

    embed.setFooter({ text: "⭐ = Booster • 🎫 = Ticket Açık • Smp Waitlist System" });
    return embed;
}

// --- BUTONLAR ---
function getMainWaitlistButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('main_smp_waitlist_btn')
            .setLabel('SMP Waitlist Al')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚔️'),
        new ButtonBuilder()
            .setCustomId('main_cooldown_check_btn')
            .setLabel('Cooldown Kontrol')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏰')
    );
}

function getQueueButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_queue_join')
            .setLabel('Katıl')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕'),
        new ButtonBuilder()
            .setCustomId('btn_queue_leave')
            .setLabel('Ayrıl')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('➖'),
        new ButtonBuilder()
            .setCustomId('btn_queue_tester_panel')
            .setLabel('Tester Paneli')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🏆')
    );
}

function getTesterPanelButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tp_toggle')
            .setLabel('Sırayı Aç / Kapat')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tp_next')
            .setLabel('Sıradan Oyuncu Çağır (Ticket Aç)')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('tp_clear')
            .setLabel('Sırayı Temizle')
            .setStyle(ButtonStyle.Danger)
    );
}

// --- TICKET KANAL OLUSTURUCU ---
async function createTestTicket(guild, targetUser, testerUser) {
    const channelName = `test-${targetUser.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '');

    const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            {
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: targetUser.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
            },
            {
                id: TESTER_ROLE_ID,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
            }
        ]
    });

    const userInfo = userFormData.get(targetUser.id) || { mcNick: targetUser.username, serverIp: "Belirtilmedi", isPremium: false };

    const embed = new EmbedBuilder()
        .setTitle("⚔️ SMP Test Bileti")
        .setColor(0xF1C40F)
        .setDescription(`Hoş geldin <@${targetUser.id}>!\nTest sıran geldi. Sorumlu Tester: <@${testerUser.id}>`)
        .addFields(
            { name: "🎮 MC Nick", value: `\`${userInfo.mcNick}\``, inline: true },
            { name: "🌐 Server IP", value: `\`${userInfo.serverIp}\``, inline: true },
            { name: "💎 Hesap Türü", value: `\`${userInfo.isPremium ? "Premium" : "Craft/Cracked"}\``, inline: true }
        )
        .setThumbnail(getMcSkinUrl(userInfo.mcNick, userInfo.isPremium))
        .setFooter({ text: "Test tamamlandığında bilet yetkili tarafından kapatılacaktır." });

    const closeBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_close_ticket')
            .setLabel('Testi Bitir / Bileti Kapat')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒')
    );

    await ticketChannel.send({
        content: `||<@${targetUser.id}> & <@&${TESTER_ROLE_ID}>||`,
        embeds: [embed],
        components: [closeBtn]
    });

    return ticketChannel;
}

// --- SLASH COMMANDS ---
const commands = [
    new SlashCommandBuilder()
        .setName('waitlist')
        .setDescription('Waitlist yönetim komutları')
        .addSubcommand(sub =>
            sub.setName('ac')
               .setDescription('Test sırasını açar'))
        .addSubcommand(sub =>
            sub.setName('kapat')
               .setDescription('Test sırasını kapatır')),
    new SlashCommandBuilder()
        .setName('testsonuc')
        .setDescription('Test sonucunu bildirir ve log kanalına atar')
        .addUserOption(opt => opt.setName('kullanici').setDescription('Test edilen oyuncu').setRequired(true))
        .addStringOption(opt => opt.setName('mcnick').setDescription('Oyuncunun MC kullanıcı adı').setRequired(true))
        .addStringOption(opt => opt.setName('yeni_tier').setDescription('Kazandığı Yeni Tier').setRequired(true))
        .addStringOption(opt => opt.setName('eski_tier').setDescription('Eski Tier Bilgisi').setRequired(true))
        .addStringOption(opt => opt.setName('kit').setDescription('Test edilen kit (Örn: sword)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setup_waitlist')
        .setDescription('SMP Waitlist mesajını gönderir')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('sira_mesaj')
        .setDescription('Canlı test sırası mesajını gönderir')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// --- BOT CLIENT LOGIC ---
client.once('ready', async () => {
    console.log(`${client.user.tag} aktif!`);
    if (CLIENT_ID && TOKEN) {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        try {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('Slash komutları güncellendi!');
        } catch (error) {
            console.error('Slash kayıt hatası:', error);
        }
    }
});

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async interaction => {

    // 1. SLASH KOMUTLARI
    if (interaction.isChatInputCommand()) {
        const { commandName, options, member, guild } = interaction;

        if (commandName === 'waitlist') {
            const isTester = member.roles.cache.has(TESTER_ROLE_ID) || member.permissions.has(PermissionFlagsBits.Administrator);
            if (!isTester) return interaction.reply({ content: "❌ Sadece **Tester** yetkilileri kullanabilir!", ephemeral: true });

            const sub = options.getSubcommand();
            if (sub === 'ac') {
                queueData.isOpen = true;
                queueData.activeTesters.add(interaction.user.id);
                return interaction.reply({ content: "🟢 **Test sırası açıldı!**", ephemeral: true });
            } else if (sub === 'kapat') {
                queueData.isOpen = false;
                queueData.activeTesters.delete(interaction.user.id);
                return interaction.reply({ content: "🔴 **Test sırası kapatıldı!**", ephemeral: true });
            }
        }

        // /testsonuc komutu
        if (commandName === 'testsonuc') {
            const isTester = member.roles.cache.has(TESTER_ROLE_ID) || member.permissions.has(PermissionFlagsBits.Administrator);
            if (!isTester) return interaction.reply({ content: "❌ Sadece **Tester** yetkilileri kullanabilir!", ephemeral: true });

            const targetUser = options.getUser('kullanici');
            const mcNick = options.getString('mcnick');
            const newTier = options.getString('yeni_tier');
            const oldTier = options.getString('eski_tier');
            const kit = options.getString('kit');

            const userInfo = userFormData.get(targetUser.id) || { isPremium: true };

            // Fotoğraftaki Birebir Tasarım (Tüm alanlar kutucuklu: `değer`)
            const resultEmbed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setAuthor({ name: `${targetUser.username} için Test Sonucu`, iconURL: targetUser.displayAvatarURL() })
                .addFields(
                    { name: "👤 Oyuncu", value: `<@${targetUser.id}>`, inline: false },
                    { name: "🧪 Tester", value: `<@${interaction.user.id}>`, inline: false },
                    { name: "⌨️ MC Nick", value: `\`${mcNick}\``, inline: false },
                    { name: "🥇 Yeni Tier", value: `\`${newTier}\``, inline: false },
                    { name: "📉 Eski Tier", value: `\`${oldTier}\``, inline: false },
                    { name: "🎯 Kit", value: `\`${kit}\``, inline: false }
                )
                .setThumbnail(getMcSkinUrl(mcNick, userInfo.isPremium))
                .setFooter({ text: "Log Sistemi" })
                .setTimestamp();

            const logChannel = guild.channels.cache.get(TEST_LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send({ embeds: [resultEmbed] });
                return interaction.reply({ content: `✅ Test sonucu başarıyla <#${TEST_LOG_CHANNEL_ID}> kanalına gönderildi!`, ephemeral: true });
            } else {
                return interaction.reply({ content: "❌ Test log kanalı bulunamadı! ID'yi kontrol edin.", ephemeral: true });
            }
        }

        if (commandName === 'setup_waitlist') {
            const embed = new EmbedBuilder()
                .setTitle("✨ Türkiye Minecraft SMP Waitlist")
                .setDescription("Aşağıdaki **SMP Waitlist Al** butonuna basarak form doldurabilir ve sıraya katılma rolü alabilirsiniz.")
                .setColor(0x3498DB);

            await interaction.channel.send({ embeds: [embed], components: [getMainWaitlistButtons()] });
            return interaction.reply({ content: "✅ Waitlist mesajı kuruldu.", ephemeral: true });
        }

        if (commandName === 'sira_mesaj') {
            await interaction.channel.send({ embeds: [createQueueEmbed(guild)], components: [getQueueButtons()] });
            return interaction.reply({ content: "✅ Sıra paneli kuruldu.", ephemeral: true });
        }
    }

    // 2. MODAL SUBMIT (FORM DOLDURULUNCA)
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_waitlist_form') {
            const mcNick = interaction.fields.getTextInputValue('input_mcnick');
            const serverIp = interaction.fields.getTextInputValue('input_serverip');
            const accType = interaction.fields.getTextInputValue('input_acctype').toLowerCase();

            const isPremium = accType.includes('prem') || accType.includes('ori');

            userFormData.set(interaction.user.id, {
                mcNick,
                serverIp,
                isPremium
            });

            const role = interaction.guild.roles.cache.get(WAITLIST_ROLE_ID);
            if (role) await interaction.member.roles.add(role);

            const isBooster = interaction.member.roles.cache.has(BOOSTER_ROLE_ID);
            const cooldownTime = isBooster ? BOOSTER_COOLDOWN : NORMAL_COOLDOWN;
            cooldowns.set(interaction.user.id, Date.now() + cooldownTime);

            return interaction.reply({ 
                content: `✅ **Waitlist Bilgileriniz Kaydedildi!**\n🎮 **MC Nick:** ${mcNick}\n🌐 **IP:** ${serverIp}\n💎 **Tür:** ${isPremium ? "Premium" : "Craft/Cracked"}\n\nSıra kanalına geçebilirsiniz.`, 
                ephemeral: true 
            });
        }
    }

    // 3. BUTON HAREKETLERİ
    if (interaction.isButton()) {
        const { customId, user, member, guild } = interaction;

        if (customId === 'main_smp_waitlist_btn') {
            const now = Date.now();
            if (cooldowns.has(user.id) && now < cooldowns.get(user.id)) {
                const rem = cooldowns.get(user.id) - now;
                const d = Math.floor(rem / (86400000));
                const h = Math.floor((rem % 86400000) / 3600000);
                return interaction.reply({ content: `⚠️ **Bekleme Süresi!** Kalan: ${d} gün ${h} saat.`, ephemeral: true });
            }

            const modal = new ModalBuilder()
                .setCustomId('modal_waitlist_form')
                .setTitle('SMP Waitlist Başvuru Formu');

            const nickInput = new TextInputBuilder()
                .setCustomId('input_mcnick')
                .setLabel('Minecraft Kullanıcı Adınız (Nick)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const ipInput = new TextInputBuilder()
                .setCustomId('input_serverip')
                .setLabel('Oynadığınız Server IP')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const typeInput = new TextInputBuilder()
                .setCustomId('input_acctype')
                .setLabel('Hesap Türü (Premium / Craft / Cracked)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Örn: Premium ya da Craft')
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(nickInput),
                new ActionRowBuilder().addComponents(ipInput),
                new ActionRowBuilder().addComponents(typeInput)
            );

            return interaction.showModal(modal);
        }

        if (customId === 'btn_queue_join') {
            if (!queueData.isOpen) return interaction.reply({ content: "❌ Test sırası **KAPALI**.", ephemeral: true });
            if (queueData.queue.includes(user.id)) return interaction.reply({ content: "❌ Zaten sıradasınız!", ephemeral: true });
            if (queueData.queue.length >= MAX_QUEUE_CAPACITY) return interaction.reply({ content: "❌ Sıra dolu!", ephemeral: true });

            const isBooster = member.roles.cache.has(BOOSTER_ROLE_ID);
            if (isBooster) {
                let idx = queueData.queue.length;
                for (let i = 0; i < queueData.queue.length; i++) {
                    const qM = guild.members.cache.get(queueData.queue[i]);
                    if (qM && !qM.roles.cache.has(BOOSTER_ROLE_ID)) { idx = i; break; }
                }
                queueData.queue.splice(idx, 0, user.id);
            } else {
                queueData.queue.push(user.id);
            }

            await interaction.message.edit({ embeds: [createQueueEmbed(guild)] });
            return interaction.reply({ content: "✅ Sıraya katıldınız!", ephemeral: true });
        }

        if (customId === 'btn_queue_leave') {
            if (!queueData.queue.includes(user.id)) return interaction.reply({ content: "❌ Sırada değilsiniz.", ephemeral: true });
            queueData.queue = queueData.queue.filter(id => id !== user.id);
            await interaction.message.edit({ embeds: [createQueueEmbed(guild)] });
            return interaction.reply({ content: "✅ Sıradan ayrıldınız.", ephemeral: true });
        }

        if (customId === 'btn_queue_tester_panel') {
            const isTester = member.roles.cache.has(TESTER_ROLE_ID) || member.permissions.has(PermissionFlagsBits.Administrator);
            if (!isTester) return interaction.reply({ content: "❌ Sadece **Tester** kullanabilir!", ephemeral: true });

            return interaction.reply({ content: "🛠️ **Tester Paneli**", components: [getTesterPanelButtons()], ephemeral: true });
        }

        if (customId === 'tp_next') {
            if (queueData.queue.length === 0) return interaction.reply({ content: "❌ Sıra boş!", ephemeral: true });

            const nextUserId = queueData.queue.shift();
            const nextUser = await client.users.fetch(nextUserId);

            const ticketChan = await createTestTicket(guild, nextUser, user);

            return interaction.reply({ content: `🔔 <@${nextUserId}> için test kanalı oluşturuldu: ${ticketChan}`, ephemeral: true });
        }

        if (customId === 'tp_toggle') {
            queueData.isOpen = !queueData.isOpen;
            if (queueData.isOpen) queueData.activeTesters.add(user.id);
            else queueData.activeTesters.delete(user.id);
            return interaction.reply({ content: `✅ Sıra: **${queueData.isOpen ? "AÇIK" : "KAPALI"}**`, ephemeral: true });
        }

        if (customId === 'tp_clear') {
            queueData.queue = [];
            return interaction.reply({ content: "🧹 Sıra temizlendi.", ephemeral: true });
        }

        if (customId === 'btn_close_ticket') {
            const isTester = member.roles.cache.has(TESTER_ROLE_ID) || member.permissions.has(PermissionFlagsBits.Administrator);
            if (!isTester) return interaction.reply({ content: "❌ Bileti sadece **Tester** kapatabilir!", ephemeral: true });

            await interaction.reply({ content: "🔒 Test bileti 5 saniye içinde siliniyor..." });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }
    }
});

client.login(TOKEN);
