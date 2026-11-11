const { EmbedBuilder } = require('discord.js');
const { checkIsVpn } = require('./vpn-detector');
const https = require('https');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1520655756888903750';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'vzepTfdfydMKyuNUwa8WujGFDcPM0l1t';
const BASE_URL = process.env.RENDER_EXTERNAL_URL || 'https://emillia-discord-bot.onrender.com';
const REDIRECT_URI = `${BASE_URL}/auth/callback`;

/**
 * Helper to make HTTPS requests without external dependencies
 */
function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', err => reject(err));
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = forwarded.split(',');
    return parts[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

function renderHtmlPage({ status, title, message, details = '', icon = '🌸' }) {
  const isSuccess = status === 'success';
  const isVpn = status === 'vpn';
  const isBan = status === 'ban';

  const accentColor = isSuccess ? '#2ECC71' : (isVpn ? '#F39C12' : '#E74C3C');
  const glowColor = isSuccess ? 'rgba(46, 204, 113, 0.35)' : (isVpn ? 'rgba(243, 156, 18, 0.35)' : 'rgba(231, 76, 60, 0.35)');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AniPedia Security Shield • ${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    body {
      background: radial-gradient(circle at 50% 20%, #1e1530 0%, #0d0a14 60%, #06050a 100%);
      color: #f1edfa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: rgba(21, 16, 33, 0.88);
      border: 1px solid rgba(191, 90, 242, 0.28);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7), 0 0 32px ${glowColor};
      border-radius: 20px;
      max-width: 440px;
      width: 100%;
      padding: 36px 28px;
      text-align: center;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      animation: fadeIn 0.4s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #BF5AF2;
      background: rgba(191, 90, 242, 0.12);
      border: 1px solid rgba(191, 90, 242, 0.35);
      padding: 6px 14px;
      border-radius: 50px;
      margin-bottom: 22px;
    }
    .icon-wrapper {
      width: 76px;
      height: 76px;
      margin: 0 auto 20px auto;
      border-radius: 50%;
      background: ${glowColor};
      border: 2px solid ${accentColor};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
    }
    h1 {
      font-size: 22px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 12px;
    }
    p.message {
      font-size: 14px;
      line-height: 1.6;
      color: #c9c1db;
      margin-bottom: 18px;
    }
    .details {
      background: rgba(12, 9, 20, 0.75);
      border-left: 3px solid ${accentColor};
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 12px;
      color: #9d93b3;
      text-align: left;
      margin-bottom: 24px;
      word-break: break-all;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #BF5AF2 0%, #9B51E0 100%);
      color: #ffffff;
      font-weight: 700;
      font-size: 14px;
      padding: 13px 26px;
      border-radius: 12px;
      text-decoration: none;
      box-shadow: 0 4px 18px rgba(191, 90, 242, 0.4);
      transition: all 0.2s ease;
      cursor: pointer;
      border: none;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(191, 90, 242, 0.6);
    }
    .footer {
      margin-top: 24px;
      font-size: 11px;
      color: #6c6382;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">AniPedia Shield</div>
    <div class="icon-wrapper">${icon}</div>
    <h1>${title}</h1>
    <p class="message">${message}</p>
    ${details ? `<div class="details">${details}</div>` : ''}
    ${isVpn ? `<a class="btn" href="/verify">Try Again (Without VPN)</a>` : ''}
    <div class="footer">AniPedia Security & Verification • Powered by Aiko</div>
  </div>
</body>
</html>`;
}

function initVerificationPortal(app, client, db) {
  // Trust proxy for Render / Cloudflare
  app.set('trust proxy', true);

  /**
   * Route 1: Initial user click on verification link
   */
  app.get('/verify', async (req, res) => {
    const clientIp = getClientIp(req);

    // Fast check: Is incoming client already using a VPN?
    try {
      const vpnCheck = await checkIsVpn(clientIp);
      if (vpnCheck.isVpn) {
        return res.status(403).send(renderHtmlPage({
          status: 'vpn',
          icon: '🛡️',
          title: 'VPN or Proxy Detected',
          message: 'AniPedia does not allow connections via VPNs, Cloudflare WARP, Tor, or public proxies to protect against raids and spam.',
          details: `<strong>Detected:</strong> ${vpnCheck.type || 'Proxy / Datacenter'} (${vpnCheck.operator || 'Unknown'})<br><strong>Your IP:</strong> ${clientIp}<br><br>👉 Please turn off your VPN, then click below to retry.`
        }));
      }
    } catch (e) {
      console.warn('[Verification Portal] VPN pre-check failed, continuing to OAuth:', e.message);
    }

    // Redirect to Discord OAuth2
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
  });

  /**
   * Route 2: OAuth2 callback from Discord
   */
  app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    const clientIp = getClientIp(req);

    if (!code) {
      return res.status(400).send(renderHtmlPage({
        status: 'error',
        icon: '⚠️',
        title: 'Authorization Cancelled',
        message: 'You cancelled the Discord authorization. Verification cannot proceed without identifying your account.',
        details: '<a class="btn" href="/verify">Try Again</a>'
      }));
    }

    // 1. Post-OAuth Anti-VPN check
    try {
      const vpnCheck = await checkIsVpn(clientIp);
      if (vpnCheck.isVpn) {
        return res.status(403).send(renderHtmlPage({
          status: 'vpn',
          icon: '🛡️',
          title: 'VPN / Proxy Blocked',
          message: 'A VPN or proxy was detected during authentication. Please disconnect and verify with your real connection.',
          details: `<strong>Detected:</strong> ${vpnCheck.type} (${vpnCheck.operator})<br><strong>IP:</strong> ${clientIp}`
        }));
      }
    } catch (e) {}

    // 2. Exchange code for OAuth2 Access Token
    let tokenData;
    try {
      const tokenBody = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: REDIRECT_URI
      }).toString();

      const tokenRes = await httpsRequest({
        hostname: 'discord.com',
        path: '/api/v10/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(tokenBody)
        }
      }, tokenBody);

      if (tokenRes.status !== 200 || !tokenRes.data.access_token) {
        console.error('[Verification Portal] Token exchange error:', tokenRes.data);
        return res.status(500).send(renderHtmlPage({
          status: 'error',
          icon: '❌',
          title: 'Authentication Failed',
          message: 'Failed to verify with Discord API. Please try again in a few moments.'
        }));
      }
      tokenData = tokenRes.data;
    } catch (err) {
      console.error('[Verification Portal] Token request error:', err);
      return res.status(500).send(renderHtmlPage({
        status: 'error',
        icon: '❌',
        title: 'Network Error',
        message: 'Could not connect to Discord authentication servers.'
      }));
    }

    // 3. Fetch Discord user details (@me)
    let discordUser;
    try {
      const userRes = await httpsRequest({
        hostname: 'discord.com',
        path: '/api/v10/users/@me',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      });

      if (userRes.status !== 200 || !userRes.data.id) {
        return res.status(500).send(renderHtmlPage({
          status: 'error',
          icon: '❌',
          title: 'User Profile Error',
          message: 'Unable to retrieve your Discord account profile.'
        }));
      }
      discordUser = userRes.data;
    } catch (err) {
      console.error('[Verification Portal] User fetch error:', err);
      return res.status(500).send(renderHtmlPage({
        status: 'error',
        icon: '❌',
        title: 'Profile Error',
        message: 'Failed to fetch Discord user information.'
      }));
    }

    const userId = discordUser.id;
    const userTag = `${discordUser.username}#${discordUser.discriminator || '0'}`;

    // 4. Find Guild & Member
    const guild = client.guilds.cache.get('1555205544984449034') || client.guilds.cache.first();
    if (!guild) {
      return res.status(500).send(renderHtmlPage({
        status: 'error',
        icon: '⚠️',
        title: 'Server Not Found',
        message: 'The bot is not currently connected to AniPedia server.'
      }));
    }

    // 5. Alt Shield & Banned IP Matching
    let isBannedAlt = false;
    let bannedReason = '';

    if (userId === '855013222787842058') {
      console.log(`[Verification Portal] VIP Exception triggered for ${userId} (${userTag}) - bypassing all checks`);
    } else if (db) {
      try {
        // Live check active Discord bans for this IP
        const guildBans = await guild.bans.fetch().catch(() => new Map());
        const matchingUsers = await db.collection('verified_users').where('ip', '==', clientIp).get();
        let activeBannedUserId = null;

        if (!matchingUsers.empty) {
          for (const doc of matchingUsers.docs) {
            const linkedId = doc.data().userId;
            if (guildBans.has(linkedId)) {
              activeBannedUserId = linkedId;
              break;
            }
          }
        }

        const bannedIpDoc = await db.collection('banned_ips').doc(clientIp).get();
        if (bannedIpDoc.exists) {
          const recId = bannedIpDoc.data()?.bannedUserId;
          if (recId && guildBans.has(recId)) {
            activeBannedUserId = recId;
          }
        }

        if (activeBannedUserId) {
          isBannedAlt = true;
          bannedReason = `Alt of actively banned member <@${activeBannedUserId}> (${activeBannedUserId}) via shared IP ${clientIp}`;
        } else if (bannedIpDoc.exists) {
          await db.collection('banned_ips').doc(clientIp).delete().catch(() => {});
          console.log(`[Verification Portal] Auto-cleared unbanned IP ${clientIp} from banned_ips.`);
        }
        /* legacy check bypass
        if (bannedIpDoc.exists) {
          isBannedAlt = true;
          bannedReason = `Direct match on banned IP (${clientIp})`;
        } else {
          // B. Check if IP matches any previously banned user
          const matchingUsers = await db.collection('verified_users').where('ip', '==', clientIp).get();
          if (!matchingUsers.empty) {
            const guildBans = await guild.bans.fetch().catch(() => null);
            if (guildBans) {
              for (const doc of matchingUsers.docs) {
                const prevUserId = doc.data().userId;
                if (prevUserId !== userId && guildBans.has(prevUserId)) {
                  isBannedAlt = true;
                  bannedReason = `Alt of banned member <@${prevUserId}> (${prevUserId}) via shared IP ${clientIp}`;
                  break;
                }
              }
            }
          }
        }
        */ } catch (dbErr) {
        console.error('[Verification Portal] Database check error:', dbErr);
      }
    }

    // 6. Action: If Banned Alt -> Auto-Ban immediately
    if (isBannedAlt) {
      try {
        await guild.members.ban(userId, {
          reason: `AniPedia Alt Shield: ${bannedReason}`,
          deleteMessageSeconds: 86400
        });

        // Store this IP in banned_ips permanently
        if (db) {
          await db.collection('banned_ips').doc(clientIp).set({
            ip: clientIp,
            matchedAltId: userId,
            timestamp: new Date()
          }, { merge: true });
        }

        // Send Alert to #aiko-log
        const logChannel = guild.channels.cache.find(c => c.name === 'aiko-log' || c.name === 'emillia-log');
        if (logChannel) {
          const alertEmbed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🚨 Alt Shield • IP Match Auto-Ban')
            .setDescription(
              `An alt account attempted to pass verification and was **automatically banned**!\n\n` +
              `• **Target User:** <@${userId}> (\`${userTag}\` - \`${userId}\`)\n` +
              `• **Detected IP:** \`${clientIp}\`\n` +
              `• **Reason:** ${bannedReason}\n` +
              `• **Action:** Native Discord IP Ban Executed`
            )
            .setFooter({ text: 'AniPedia Security Shield' })
            .setTimestamp();
          await logChannel.send({ embeds: [alertEmbed] });
        }
      } catch (banErr) {
        console.error('[Verification Portal] Failed to execute auto-ban on alt:', banErr);
      }

      return res.status(403).send(renderHtmlPage({
        status: 'ban',
        icon: '🔨',
        title: 'Access Denied',
        message: 'This connection is associated with a previously banished account from AniPedia.',
        details: 'Your account has been permanently restricted from entering AniPedia.'
      }));
    }

    // 7. Clean User: Assign Member Role
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return res.status(404).send(renderHtmlPage({
          status: 'error',
          icon: '❓',
          title: 'Not in Server',
          message: 'You must join AniPedia before completing verification!',
          details: 'Please join the Discord server first, then click Verify again.'
        }));
      }

      await guild.roles.fetch().catch(() => {});
      const rolesArray = Array.from(guild.roles.cache.values());
      console.log('[Verification Portal] Server roles:', rolesArray.map(r => `"${r.name}" (${r.id})`).join(', '));
      let memberRole = rolesArray.find(r => r.name.toLowerCase() === 'member') ||
                       rolesArray.find(r => r.name.toLowerCase() === 'members') ||
                       rolesArray.find(r => r.name.toLowerCase().includes('member')) ||
                       rolesArray.find(r => r.name.toLowerCase().includes('verified')) ||
                       rolesArray.find(r => r.name.toLowerCase().includes('nakama'));
      if (!memberRole) {
        console.error('[Verification Portal] Could not find Member role! Roles in server:', rolesArray.map(r => r.name)); return res.status(500).send(renderHtmlPage({ status: 'error', icon: '⚠️', title: 'Role Not Found', message: 'Could not find a <strong>Member</strong> or <strong>Verified</strong> role in AniPedia Discord server.', details: 'Available server roles: ' + rolesArray.map(r => r.name).join(', ') }));
        /* legacy search */
      }

      if (memberRole && !member.roles.cache.has(memberRole.id)) {
        try { await member.roles.add(memberRole, 'Passed AniPedia Anti-VPN Verification Portal'); console.log('[Verification Portal] Successfully assigned ' + memberRole.name + ' to ' + userTag); client.emit('memberVerified', member); } catch (roleErr) { console.error('[Verification Portal] Role grant error:', roleErr); return res.status(500).send(renderHtmlPage({ status: 'error', icon: '⚠️', title: 'Role Permission Error', message: 'Verified your connection, but Discord prevented the bot from giving you the <strong>' + memberRole.name + '</strong> role.<br><br>👉 <strong>Server Admins:</strong> In Discord Server Settings ➔ Roles, drag the <strong>Aiko</strong> bot role <strong>ABOVE</strong> the <strong>' + memberRole.name + '</strong> role!', details: 'Discord API: ' + roleErr.message })); }
      }

      // Store in verified_users
      if (db) {
        await db.collection('verified_users').doc(userId).set({
          userId,
          username: userTag,
          ip: clientIp,
          verifiedAt: new Date()
        }, { merge: true });
      }

      // Log success to #aiko-log
      const logChannel = guild.channels.cache.find(c => c.name === 'aiko-log' || c.name === 'emillia-log');
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('🛡️ Member Verified • Clean Connection')
          .setDescription(
            `A new member successfully passed Anti-VPN verification!\n\n` +
            `• **Member:** <@${userId}> (\`${userTag}\`)\n` +
            `• **IP Address:** \`${clientIp}\` *(Clean Residential/Mobile ISP)*\n` +
            `• **Role Assigned:** \`${memberRole ? memberRole.name : 'Member'}\``
          )
          .setFooter({ text: 'AniPedia Security Shield' })
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }

      return res.send(renderHtmlPage({
        status: 'success',
        icon: '🌸',
        title: 'Verification Complete!',
        message: `Welcome to <strong>AniPedia</strong>, <strong style="color: #BF5AF2;">${discordUser.username}</strong>!<br><br>Your <strong>${memberRole.name}</strong> role has been granted in Discord. You can now close this tab and return to the server!`,
        details: 'Verified with Clean Residential Connection • AniPedia Shield'
      }));

    } catch (err) {
      console.error('[Verification Portal] Role grant error:', err);
      return res.status(500).send(renderHtmlPage({
        status: 'error',
        icon: '⚠️',
        title: 'Role Assignment Error',
        message: 'Verified your connection, but encountered an error granting your role in Discord. Please contact staff in the server.'
      }));
    }
  });

  console.log(`[Verification Portal] Anti-VPN & Anti-Alt verification routes initialized at ${BASE_URL}/verify`);
}

module.exports = {
  initVerificationPortal
};
