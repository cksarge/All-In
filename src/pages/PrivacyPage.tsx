import { Link } from 'react-router-dom';
import { ContactEmail, LegalDoc, type LegalSection } from '@/components/legal/LegalDoc';
import { LEGAL } from '@/lib/legal';

const sections: LegalSection[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <>
        <p>
          All In (the &quot;game&quot;, at {LEGAL.site}) is a free online game run by {LEGAL.operator}, an individual in {LEGAL.place}{' '}
          (&quot;we&quot;, &quot;us&quot;). We decide how the information described here is used. You can reach us at <ContactEmail />.
        </p>
        <p>
          This policy explains what information the game collects, why, who else handles it and what you can do about it. It goes with the{' '}
          <Link to="/terms">Terms of Service</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <>
        <p>
          <strong>What you give us</strong>
        </p>
        <ul>
          <li>
            <strong>Email address</strong>, to create your account, send your verification and password reset codes, and answer you if you write
            to us.
          </li>
          <li>
            <strong>Password.</strong> It is stored only as a scrambled (hashed) value by our sign-in provider. We cannot see it.
          </li>
          <li>
            <strong>Username</strong>, and a club name and tag if you start a club.
          </li>
          <li>
            <strong>Chat messages.</strong> What you type in chat at a table, in a live room or in a club, and in direct messages to
            friends, with the time and place. If the
            filter changed or stopped a message, what you originally typed is kept too, for the moderator.
          </li>
          <li>
            <strong>Reports.</strong> If you report a player: who you reported, the reason you picked, and the short note if you wrote one. If
            you report a chat message, a copy of that message is kept with the report.
          </li>
          <li>
            <strong>Appeals.</strong> If a moderator limits your account and you send an appeal: what you wrote, what it was about, and the
            moderator&apos;s answer.
          </li>
          <li>
            <strong>Two-step verification.</strong> Whether you have switched it on, and when. With it on, we email a 6-digit code to your
            address each time you log in. The codes are made and checked by our sign-in provider; the game does not keep them.
          </li>
          <li>
            <strong>The record that you accepted</strong> the Terms of Service and this policy, with the version and the time.
          </li>
          <li>Anything you send us by email.</li>
        </ul>
        <p>
          <strong>What the game records as you play</strong>
        </p>
        <ul>
          <li>Your play chip balance and the history of how it changed.</li>
          <li>The rounds, hands and tournaments you played and their results, and statistics worked out from them.</li>
          <li>Your level, achievements, cosmetics, missions, season progress and trophies.</li>
          <li>Your friends, friend requests, players you blocked, your club, and invitations and notifications sent to you.</li>
          <li>Which table you are sitting at, which game you have open, whether you are online, and when you were last active.</li>
          <li>Any limit placed on your account by a moderator (a warning, a timeout, a ban, a chat ban or a forced change of name) and the reason.</li>
          <li>
            Your <strong>reputation</strong>: a number from 0 to 100 worked out from how you use chat and from moderators&apos; decisions, with a
            short history of what changed it.
          </li>
        </ul>
        <p>
          <strong>What is collected automatically</strong>
        </p>
        <ul>
          <li>
            <strong>Technical data.</strong> When your browser talks to the game, the companies that host it receive your IP address, the time,
            the page or request, and details of your browser and device, and keep them in their logs for security and troubleshooting. A rough
            location (such as a country or city) can be worked out from an IP address. We do not use this to build a profile of you.
          </li>
          <li>
            <strong>Bot check.</strong> When you sign up, log in or ask for a code, a check from Cloudflare (Turnstile) looks at signals from your
            browser to tell people from bots.
          </li>
        </ul>
        <p>
          <strong>What we do not collect:</strong> your real name, postal address, phone number, date of birth, payment details (there is nothing
          to pay for, and no purchases exist in the game), contacts, precise location or photos. Quick chat (the preset phrases and emotes) is
          not stored. Please do not put personal or contact details in typed chat.
        </p>
      </>
    ),
  },
  {
    id: 'storage',
    title: 'Cookies and storage in your browser',
    body: (
      <>
        <p>
          The game itself does not use advertising or tracking cookies, and it has no analytics or advertising. It keeps a few things in your
          browser&apos;s local storage on your own device:
        </p>
        <ul>
          <li>your sign-in session, so you stay logged in;</li>
          <li>your settings (sound, motion, keyboard shortcuts, turn alerts, guides you have seen), your favourite games and the last games you opened;</li>
          <li>small conveniences such as your last bet at a table and the bet presets you save;</li>
          <li>your scores in the practice drills, which never leave your device.</li>
        </ul>
        <p>
          These are needed for the game to work or are kept at your choice, and clearing your browser&apos;s site data removes them (and signs you
          out). The bot check from Cloudflare may set a cookie of its own that is strictly for security.
        </p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'How we use it',
    body: (
      <>
        <ul>
          <li>
            <strong>To run the game:</strong> to sign you in, keep your chips and progress, run the games fairly on the server, seat you with other
            players, and show leaderboards, profiles and results.
          </li>
          <li>
            <strong>To send account emails:</strong> verification and password reset codes, login codes if you use two-step verification, and replies to messages you send us. We do not send
            marketing email.
          </li>
          <li>
            <strong>To keep the game fair and safe:</strong> to stop bots and abuse, look into reports and suspected cheating, and enforce the
            Terms of Service. Every typed chat message is checked automatically by a filter that stars out swear words and stops spam and
            advertising, and the result moves your reputation up or down.
          </li>
          <li>
            <strong>To fix and improve the game:</strong> to find faults and understand in general how the game is used.
          </li>
          <li>
            <strong>To meet legal duties</strong> and protect our rights and those of players.
          </li>
        </ul>
        <p>
          We do not sell your personal information and we do not share it for advertising. The only automatic decisions made about you are
          the chat filter and the reputation it feeds, which can switch off your chat inside the game. They have no effect outside the game,
          and you can ask us to have a person look at one by writing to us.
        </p>
        <p>
          Where the law asks for a legal basis (for example in the European Economic Area and the United Kingdom), we rely on: carrying out our
          agreement with you (running your account and the game); our legitimate interests in keeping the game fair, secure and working; your
          consent where we ask for it; and legal obligations.
        </p>
      </>
    ),
  },
  {
    id: 'others-see',
    title: 'What other players can see',
    body: (
      <>
        <p>All In is a multiplayer game, so some things about your account are visible to other signed-in players:</p>
        <ul>
          <li>your username, level, avatar, frame and title;</li>
          <li>your profile: achievements, trophies, playing statistics and records, and your club;</li>
          <li>where you are on the leaderboards, and big wins shown in the lounge;</li>
          <li>what you do at a shared table or in a shared room: your seat, your bets, your chips on the table, and cards that are shown;</li>
          <li>
            what you say in chat: the players at that table, in that room or in that club see your typed messages (with swear words starred
            out) under your username, and your quick chat. Whether your chat has been switched off may be apparent to them;
          </li>
          <li>
            to your friends: whether you are online, which public table you are at, and, unless you switch it off on the Friends page,
            which game you have open on your own and how your last few rounds there went;
          </li>
          <li>to a friend you exchange direct messages with: those messages.</li>
        </ul>
        <p>
          <strong>Your email address is never shown to other players.</strong> Neither are your password, the cards you hold that are meant to be
          hidden, your reputation number, reports you make, or who you have blocked. The moderator can read chat messages, including what
          the filter stopped, in order to review reports and enforce the rules. That includes direct messages: they are private from other
          players, not from the moderator. Choose a username that does not identify you in real life if you would rather not be
          recognised.
        </p>
      </>
    ),
  },
  {
    id: 'providers',
    title: 'Companies that handle data for us',
    body: (
      <>
        <p>We use a small number of service providers to run the game. They handle information on our behalf, under their own terms and privacy policies:</p>
        <ul>
          <li>
            <strong>Supabase</strong>: the database and sign-in system. Your account and everything the game records are stored here.
          </li>
          <li>
            <strong>GitHub</strong> (GitHub Pages): serves the website&apos;s files to your browser.
          </li>
          <li>
            <strong>Cloudflare</strong> (Turnstile): the bot check on sign-up, log-in and code requests.
          </li>
          <li>
            <strong>Resend</strong>: delivers the verification, password reset and login code emails, so it handles your email address.
          </li>
          <li>
            <strong>Google</strong> (Google Fonts): the site&apos;s typefaces are loaded from Google, which therefore receives your IP address and
            browser details.
          </li>
        </ul>
        <p>We may also disclose information:</p>
        <ul>
          <li>when the law, a court or a lawful request from an authority requires it;</li>
          <li>to protect the safety, rights or property of players, the public or ourselves, or to investigate abuse;</li>
          <li>to someone who takes over running the game, who would have to keep to this policy or tell you about any change.</li>
        </ul>
        <p>
          The game&apos;s source code is public. The code contains no player data: accounts and game records live only in the database.
        </p>
      </>
    ),
  },
  {
    id: 'where',
    title: 'Where your data is kept',
    body: (
      <p>
        We are based in the United States, and our providers process data in the United States and in other countries where they operate. If you
        use the game from somewhere else, your information will be transferred to and handled in countries whose data protection laws may differ
        from yours. Where the law requires safeguards for such transfers, we rely on those our providers put in place, such as standard
        contractual clauses.
      </p>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <ul>
        <li>
          <strong>Your account and progress</strong> are kept for as long as you have an account. When you ask us to delete it, we delete the
          account and the data tied to it, normally within 30 days.
        </li>
        <li>
          <strong>Detailed play history</strong> (old rounds, hands, bets and chip activity) is trimmed from time to time, keeping only recent
          entries. Totals and statistics remain.
        </li>
        <li>
          <strong>Chat messages</strong>, including direct messages, are deleted after 3 days. A message that was reported is kept with the report until the matter is
          settled and for up to 90 days afterwards.
        </li>
        <li>
          <strong>Appeals</strong> are kept until they are answered and for up to 90 days afterwards.
        </li>
        <li>
          <strong>Reputation</strong> is kept with your account, with the history of its last 50 changes.
        </li>
        <li>
          <strong>Reports and moderation records</strong> are kept while they are needed to deal with a matter and to stop repeat abuse. If an
          account is banned, we may keep the minimum needed to keep the ban in place.
        </li>
        <li>
          <strong>Provider logs and backups</strong> are kept for the periods our providers set, and deleted data can remain in backups for a
          limited time before it is overwritten.
        </li>
        <li>Emails you send us are kept for as long as needed to deal with them.</li>
      </ul>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: (
      <p>
        Connections to the game are encrypted. Passwords are stored only in hashed form. The database enforces rules about who can read what, so
        a player&apos;s browser can only read what that player is allowed to see, and every chip change and game result is decided on the server.
        Even so, no system is perfectly secure, and we cannot guarantee that information will never be accessed, lost or disclosed. Use a password
        you do not use anywhere else. If we learn of a breach affecting your personal information, we will tell you as the law requires.
      </p>
    ),
  },
  {
    id: 'rights',
    title: 'Your choices and rights',
    body: (
      <>
        <p>
          Write to <ContactEmail /> from the email address on your account and we will help you:
        </p>
        <ul>
          <li>
            <strong>see</strong> the personal information we hold about you, or get a copy of it;
          </li>
          <li>
            <strong>correct</strong> it if it is wrong;
          </li>
          <li>
            <strong>delete</strong> your account and the data tied to it;
          </li>
          <li>
            <strong>object to or limit</strong> a use of it, or take back a consent you gave.
          </li>
        </ul>
        <p>
          We will answer within 30 days, or sooner where the law requires. We may need to check that the request really comes from you, and we may
          keep what the law requires or allows us to keep (for example, the record of a ban). Using these rights costs nothing, and we will not
          treat you worse for using them.
        </p>
        <p>
          Depending on where you live (for example the European Economic Area, the United Kingdom, or some US states including California), the
          law may give you these and further rights, including the right to complain to your data protection authority. We do not sell personal
          information or share it for cross-context behavioural advertising, so there is nothing to opt out of. The game does not respond to
          &quot;Do Not Track&quot; browser signals because it does not track you across sites.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <>
        <p>
          The game is not for children under {LEGAL.minAge}, and we do not knowingly collect personal information from them. If you are under{' '}
          {LEGAL.minAge}, do not create an account or send us any information.
        </p>
        <p>
          If you are a parent or guardian and believe a child under {LEGAL.minAge} has made an account, write to <ContactEmail /> and we will
          delete it. Players aged {LEGAL.minAge} to 17 need a parent&apos;s or guardian&apos;s permission, and a parent or guardian can ask us to
          show, correct or delete their child&apos;s account in the same way.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        We may update this policy as the game changes. When we do, we will change the effective date at the top of this page, and for changes
        that matter we will also say so in the game. The earlier versions can be seen in the history of the game&apos;s public repository.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions, requests and complaints about privacy: <ContactEmail />. We are {LEGAL.operator}, {LEGAL.place}.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      eyebrow="Your information"
      title="Privacy Policy"
      other={{ to: '/terms', label: 'Terms of Service' }}
      sections={sections}
      summary={
        <>
          <p>To play, we need an email address, a username and a password. The game then records how you play: your chips, results, progress, friends and club.</p>
          <p>Other players see your username, profile, what you do at shared tables and what you say in chat. They never see your email address.</p>
          <p>Typed chat is filtered automatically, kept for 3 days, and can be read by the moderator. How you chat moves a reputation number that only you and the moderator see.</p>
          <p>There are no ads, no analytics and no tracking cookies, and we do not sell your information. A few companies host the game and handle data for us.</p>
          <p>You can ask to see, correct or delete your data at any time by writing to {LEGAL.email}.</p>
        </>
      }
    />
  );
}
