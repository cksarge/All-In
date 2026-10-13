import { Link } from 'react-router-dom';
import { ContactEmail, LegalDoc, type LegalSection } from '@/components/legal/LegalDoc';
import { LEGAL } from '@/lib/legal';

const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreeing to these terms',
    body: (
      <>
        <p>
          All In (the &quot;game&quot;, at {LEGAL.site}) is a free online game run by {LEGAL.operator}, an individual in {LEGAL.place}{' '}
          (&quot;we&quot;, &quot;us&quot;). These Terms of Service are an agreement between you and us.
        </p>
        <p>
          By creating an account or using the game you agree to these terms and confirm that you have read the{' '}
          <Link to="/privacy">Privacy Policy</Link>. If you do not agree, do not create an account or use the game.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: 'Who can play',
    body: (
      <>
        <ul>
          <li>
            You must be at least <strong>{LEGAL.minAge} years old</strong>. If you are under {LEGAL.minAge}, you may not create an account or
            use the game.
          </li>
          <li>
            If you are under 18 (or under the age of majority where you live), you may use the game only with the permission of a parent or
            legal guardian, who agrees to these terms on your behalf and is responsible for your use of the game.
          </li>
          <li>
            You may use the game only where doing so is lawful. The game imitates casino games for entertainment. If games of this kind are
            not allowed for you where you live, even without money, do not use it.
          </li>
          <li>You may not use the game if we have banned you from it.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'free-game',
    title: 'A free game with play chips only',
    body: (
      <>
        <p>
          <strong>All In is not gambling.</strong> There is no real money anywhere in the game, and there are no purchases of any kind.
        </p>
        <ul>
          <li>
            The game is played with play chips. Play chips are given to you free. They cannot be paid for, and they have{' '}
            <strong>no cash value</strong>.
          </li>
          <li>
            Play chips, levels, achievements, cosmetics, trophies and everything else you earn in the game are a part of the game only. They
            cannot be exchanged, redeemed or converted into money, goods, services or anything else of value, by us or by anyone else.
          </li>
          <li>There are no prizes of real-world value. Tournaments, missions, seasons and leaderboards award play chips and in-game items only.</li>
          <li>
            You may not sell, trade, gift for value or transfer play chips, in-game items or your account, inside or outside the game, and you
            may not offer or ask for anything of value in connection with them.
          </li>
          <li>
            The game is for entertainment. How you do here says nothing about how you would do at real-money gambling, and winning here does
            not mean you would win there.
          </li>
        </ul>
        <p>
          If gambling is a problem for you or someone you know, help is available. In the United States you can call or text{' '}
          <strong>1-800-GAMBLER</strong> at any time. Elsewhere, look for the problem gambling helpline in your country.
        </p>
      </>
    ),
  },
  {
    id: 'account',
    title: 'Your account',
    body: (
      <>
        <ul>
          <li>You need an account to play. Give a real email address that you control: it is how you verify the account and reset your password.</li>
          <li>Keep your password to yourself. You are responsible for what happens under your account. Tell us at once if you think someone else has got into it.</li>
          <li>One person per account. Do not share your account, and do not create more than one account to gain an advantage.</li>
          <li>
            Your username, and any club name or tag you choose, are shown to other players. They must not be offensive, hateful, sexual or
            threatening, must not pretend to be someone else or a member of staff, and must not contain personal or contact details.
          </li>
          <li>
            You can stop using the game at any time. To have your account deleted, write to <ContactEmail /> from the email address on the
            account.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'conduct',
    title: 'Fair play and behaviour',
    body: (
      <>
        <p>When you use the game you agree not to:</p>
        <ul>
          <li>cheat, or use bots, scripts, automation or modified software to play or to collect chips or rewards;</li>
          <li>team up with other players against others at a table (collusion), deliberately lose chips to another player, or use several accounts at the same table;</li>
          <li>exploit a bug or mistake in the game instead of reporting it to us;</li>
          <li>try to read information you are not meant to see, such as other players&apos; cards or the cards still to come;</li>
          <li>harass, threaten, bully or abuse other players, including through usernames, club names, chat or false reports;</li>
          <li>get around a ban, timeout or other limit placed on you;</li>
          <li>attack, overload, probe or disrupt the game or the services it runs on, or try to reach another player&apos;s account or data;</li>
          <li>use the game for anything unlawful, or to advertise or promote anything, including real-money gambling.</li>
        </ul>
        <p>
          If you find a security problem, please tell us privately at <ContactEmail /> and give us reasonable time to fix it before telling
          anyone else.
        </p>
      </>
    ),
  },
  {
    id: 'chat',
    title: 'Chat and reputation',
    body: (
      <>
        <p>
          You can talk to other players with typed chat and with quick chat (preset phrases and emotes) at tables, in live rooms and in clubs,
          and send direct messages to your friends. The same rules, filter and reputation apply to direct messages.
          What you type is seen by the other players there and is stored for a short time so that it can be shown, reported and reviewed. Do not
          share personal or contact details in chat, yours or anyone else&apos;s.
        </p>
        <p>In chat you agree not to:</p>
        <ul>
          <li>swear or use slurs, or use sexual, hateful, threatening or harassing language;</li>
          <li>spam, flood or repeat messages;</li>
          <li>advertise or promote anything, post links, or ask players to follow, join or contact you elsewhere;</li>
          <li>get round the chat filter, for example by spelling a word differently;</li>
          <li>encourage anyone to break these terms or the law.</li>
        </ul>
        <p>
          An automatic filter checks every typed message. It stars out swear words and stops messages that look like spam or advertising. It
          can make mistakes in both directions, and it does not make chat safe: other players, not us, are responsible for what they write.
          Everyone must wait a few seconds between messages.
        </p>
        <p>
          Every account has a <strong>reputation</strong> from 0 to 100, which only you and the moderator can see. It rises slowly when you
          chat well and falls when the filter catches a message or a moderator acts on your account, and a report you make that is judged
          false costs you some too. A low reputation switches off typed chat, and a lower one switches off quick chat as well. A high
          reputation earns cosmetics that are yours only while your reputation stays that high: they are removed if it drops. A moderator can
          also change a reputation, or switch chat off for an account, at any time. The exact numbers are shown on your profile and may
          change.
        </p>
      </>
    ),
  },
  {
    id: 'moderation',
    title: 'Moderation',
    body: (
      <>
        <p>
          Players can report other players, and can block them. We may review reports and what happened in the game, and we may act when we
          believe these terms have been broken or when it is needed to protect players or the game. We may, with or without warning:
        </p>
        <ul>
          <li>change or remove a username, club name or club, or remove chat messages;</li>
          <li>give a warning, lower a reputation, or switch off typed chat or quick chat for an account;</li>
          <li>remove a player from a table or a tournament;</li>
          <li>correct, reduce or reset chips, progress or rewards that were gained unfairly or by mistake;</li>
          <li>limit an account for a time, or ban it for good.</li>
        </ul>
        <p>
          We are not required to monitor the game and do not promise to act on every report. Decisions are made in good faith. If you think
          one was a mistake, write to <ContactEmail />.
        </p>
      </>
    ),
  },
  {
    id: 'virtual-items',
    title: 'Chips and in-game items belong to the game',
    body: (
      <>
        <p>
          You do not own play chips, cosmetics or any other in-game item. We give you a personal, limited permission to use them inside the
          game, which we can change or end. Because they have no value and cost nothing:
        </p>
        <ul>
          <li>we may change how they are earned, what they do or how many there are, and we may add, change, reset or remove them;</li>
          <li>seasonal rewards, seasonal games and their missions are available only during their season and are gone when it ends;</li>
          <li>reputation cosmetics are held only while your reputation is high enough, and are taken away when it is not;</li>
          <li>balances, progress and items may be lost through a fault, a correction or the closing of the game, and we owe nothing for them;</li>
          <li>nothing is owed to you for chips, progress or items when an account is closed, by you or by us.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'changes-to-game',
    title: 'The game can change or stop',
    body: (
      <>
        <p>
          The game is a personal project offered free of charge. We may change any part of it, including games, rules, odds, payouts and
          features, take it offline for maintenance, or shut it down for good, at any time and without notice. We do not promise that it will
          always be available, that it will be free of faults, or that your data will be kept for ever.
        </p>
        <p>
          Every game is run by the server using random numbers and published rules. A result the server has recorded is final, except where we
          correct a fault.
        </p>
      </>
    ),
  },
  {
    id: 'ownership',
    title: 'Who owns what',
    body: (
      <>
        <ul>
          <li>
            The game&apos;s source code is public and is offered under the licence in its repository. That licence, not these terms, covers what
            you may do with the code.
          </li>
          <li>
            The All In name, the running game at {LEGAL.site}, and its account data are not covered by that licence. You may not present a copy
            of the game as this one, or as run or approved by us.
          </li>
          <li>
            You keep whatever rights you have in a username or club name you choose and in what you write in chat, and you allow us to store,
            show and review them as part of running and moderating the game.
          </li>
          <li>
            The music in the game belongs to its creators and is used under their licences, which are shown under Music credits in Settings.
          </li>
          <li>If you send us ideas or feedback, we may use them without owing you anything.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'third-parties',
    title: 'Services the game relies on',
    body: (
      <p>
        The game runs on services provided by other companies (for hosting, the database, sign-in, email and protection against bots). The{' '}
        <Link to="/privacy">Privacy Policy</Link> lists them. We are not responsible for those services, and their own terms apply to them.
        Links to other sites are provided for convenience only.
      </p>
    ),
  },
  {
    id: 'disclaimers',
    title: 'No warranties',
    body: (
      <p>
        The game is provided <strong>&quot;as is&quot; and &quot;as available&quot;</strong>, without warranties of any kind, whether express,
        implied or statutory, including implied warranties of merchantability, fitness for a particular purpose, title and non-infringement, to
        the fullest extent the law allows. We do not warrant that the game will be uninterrupted, secure or free of errors, or that any result,
        balance or record will be kept or be correct.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limit of liability',
    body: (
      <>
        <p>
          To the fullest extent the law allows, we will not be liable for any indirect, incidental, special, consequential, exemplary or punitive
          damages, or for any loss of data, play chips, progress, in-game items, profits or goodwill, arising from or related to the game or
          these terms, however caused and even if we were told it could happen.
        </p>
        <p>
          The game is free and you pay us nothing. To the fullest extent the law allows, our total liability for all claims related to the game
          or these terms will not exceed fifty United States dollars (USD 50).
        </p>
        <p>
          Some places do not allow some of these limits, so parts of this section may not apply to you. Nothing in these terms limits liability
          that cannot be limited by law.
        </p>
      </>
    ),
  },
  {
    id: 'indemnity',
    title: 'If your actions cause a claim',
    body: (
      <p>
        To the extent the law allows, you agree to cover us for claims, losses and reasonable costs (including legal fees) that result from your
        breaking these terms or the law, or from your misuse of the game. This does not apply to the extent a claim was caused by us.
      </p>
    ),
  },
  {
    id: 'ending',
    title: 'Ending this agreement',
    body: (
      <p>
        You may stop using the game and ask for your account to be deleted at any time. We may suspend or close your account, or stop offering the
        game to you, at any time, including when we believe you have broken these terms. The sections that by their nature should continue
        (including those on play chips having no value, ownership, no warranties, the limit of liability and the law that applies) continue after
        the agreement ends.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Law and disputes',
    body: (
      <>
        <p>
          Please write to <ContactEmail /> first if you have a complaint. Most things can be sorted out that way.
        </p>
        <p>
          These terms are governed by the laws of the State of Arizona, United States, without regard to its rules on conflicts of law. Any dispute
          that cannot be settled informally will be brought in the state or federal courts located in Arizona, and you and we accept the
          jurisdiction of those courts. If you are a consumer living somewhere whose law gives you rights that cannot be given up by agreement,
          those rights are not affected.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. When we do, we will change the effective date at the top of this page, and for changes that matter we will also
        say so in the game (for example with a notice under the top bar). The updated terms apply from their effective date. If you keep using
        the game after that, you accept them. If you do not agree, stop using the game and ask for your account to be deleted.
      </p>
    ),
  },
  {
    id: 'general',
    title: 'General',
    body: (
      <ul>
        <li>These terms and the Privacy Policy are the whole agreement between you and us about the game.</li>
        <li>If a court finds part of these terms cannot be enforced, the rest stays in force.</li>
        <li>If we do not enforce a term, that does not mean we have given it up.</li>
        <li>You may not transfer your rights under these terms. We may transfer ours to someone who takes over running the game.</li>
        <li>
          Contact: <ContactEmail />
        </li>
      </ul>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDoc
      eyebrow="The house rules"
      title="Terms of Service"
      other={{ to: '/privacy', label: 'Privacy Policy' }}
      sections={sections}
      summary={
        <>
          <p>All In is a free game. There is no real money, no gambling and no purchases. Play chips and everything you earn have no cash value and can&apos;t be traded or redeemed.</p>
          <p>You must be {LEGAL.minAge} or older, and under 18 you need a parent&apos;s or guardian&apos;s permission.</p>
          <p>Play fair and be decent to other players, in chat too: no swearing, spam or advertising. Chat is filtered, and how you behave moves your reputation.</p>
          <p>We can change or close the game, and we can limit or ban accounts that break the rules.</p>
        </>
      }
    />
  );
}
