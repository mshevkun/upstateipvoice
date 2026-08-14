/**
 * Generate blog.html + six article pages, then wire Blog into site nav/footers.
 * Run: node scripts/build-blog.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const CTA_ARROW = `<svg class="index-science-features__cta-arrow" width="19" height="17" viewBox="0 0 19 17" aria-hidden="true" focusable="false">
                    <path d="M0 8H18M7 0L18 8M7 16L18 8" stroke="currentColor" fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>`;

const ASIDE = `
          <aside class="solutions-buckets__aside" aria-label="Resources">
            <div class="solutions-buckets__aside-sticky">
              <article class="solutions-buckets__listing">
                <a class="solutions-buckets__listing-media" href="/review/">
                  <img src="images/index/mission-crowd.png" alt="" width="717" height="480" loading="lazy" decoding="async">
                </a>
                <p class="solutions-buckets__listing-type">Get started</p>
                <h3 class="solutions-buckets__listing-title">
                  <a href="/review/">Book a communications review for your business</a>
                </h3>
                <a class="solutions-buckets__listing-cta" href="/review/">Learn more</a>
              </article>

              <article class="solutions-buckets__listing">
                <a class="solutions-buckets__listing-media" href="blog-one-number-every-device.html">
                  <img src="images/index/science-mobile-app.png" alt="Upstate IP Voice mobile app call history screen" width="1024" height="1024" loading="lazy" decoding="async">
                </a>
                <p class="solutions-buckets__listing-type">From the blog</p>
                <h3 class="solutions-buckets__listing-title">
                  <a href="blog-one-number-every-device.html">One number, every device - stop missing calls away from the desk</a>
                </h3>
                <a class="solutions-buckets__listing-cta" href="blog-one-number-every-device.html">Read article</a>
              </article>

              <article class="solutions-buckets__listing">
                <a class="solutions-buckets__listing-media" href="blog-after-hours-call-flow.html">
                  <img src="images/index/science-automations.png" alt="Upstate IP Voice automations dashboard on laptop" width="1024" height="1024" loading="lazy" decoding="async">
                </a>
                <p class="solutions-buckets__listing-type">From the blog</p>
                <h3 class="solutions-buckets__listing-title">
                  <a href="blog-after-hours-call-flow.html">What happens to a call after hours - and how to never leave it unanswered</a>
                </h3>
                <a class="solutions-buckets__listing-cta" href="blog-after-hours-call-flow.html">Read article</a>
              </article>
            </div>
          </aside>`;

const FOOTER = fs.readFileSync(path.join(ROOT, "partials", "site-footer.html"), "utf8").trim();

function head({ title, description, keywords, canonical, ogTitle, ogDescription, ogImage, ogType = "article" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" type="image/png" sizes="48x48" href="/images/favicon-48.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/images/favicon-192.png">
  <link rel="apple-touch-icon" href="/images/favicon-192.png">
  <link rel="icon" type="image/svg+xml" href="/images/favicon.svg" sizes="any">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="keywords" content="${keywords}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:site_name" content="Upstate IP Voice">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <link rel="preload" as="image" href="images/voip-support-team.webp" fetchpriority="high" media="(min-width: 1024px)">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700&family=Source+Sans+3:wght@300;400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css?v=20260813m10">
</head>`;
}

function headers(active = "blog") {
  const link = (href, label, key) => {
    const isActive = active === key;
    return isActive
      ? `<a href="${href}" class="active" aria-current="page">${label}</a>`
      : `<a href="${href}">${label}</a>`;
  };
  const li = (href, label, key) => {
    const isActive = active === key;
    return isActive
      ? `<li><a href="${href}" class="active">${label}</a></li>`
      : `<li><a href="${href}">${label}</a></li>`;
  };
  return `  <header class="mobileHeader" aria-label="Site header">
    <a href="index.html" class="brand"><img src="images/original logo.svg" alt="Upstate IP Voice" class="mobileHeader-logo"></a>
    <button type="button" class="menuBtn" aria-label="Open menu" aria-expanded="false">
      <span class="menuBtn-bar"></span>
      <span class="menuBtn-bar"></span>
    </button>
    <div class="mobileMenuOverlay" aria-hidden="true"></div>
    <aside class="mobileMenuPanel" aria-label="Main menu">
      <div class="menuTop">
        <a href="index.html" class="menuTop-logo" aria-label="Upstate IP Voice"><img src="images/original logo.svg" alt="" width="120" height="32"></a>
        <button type="button" class="closeBtn" aria-label="Close menu"><span aria-hidden="true">&times;</span></button>
      </div>
      <p class="menuNavLabel">Navigate</p>
      <nav class="menuLinks">
        ${link("solutions.html", "Solutions", "solutions")}
        ${link("about.html", "About Us", "about")}
        ${link("blog.html", "Blog", "blog")}
        ${link("support.html", "Support", "support")}
        <a href="support.html#get-support">Contact</a>
      </nav>
      <div class="menuCTA">
        <a href="https://app.upstateipvoice.com/login" class="menuCTA-btn">Login</a>
      </div>
      <div class="menuMeta">
        <a href="tel:+18452558500">(845) 255-8500</a>
        <a href="mailto:info@upstateipvoice.com">info@upstateipvoice.com</a>
      </div>
    </aside>
  </header>
  <header class="site-header">
    <div class="container header-inner">
      <a href="index.html" class="logo"><img src="images/white transparent.svg" alt="Upstate IP Voice" class="logo-img logo-img-desktop"><img src="images/original logo.svg" alt="Upstate IP Voice" class="logo-img logo-img-mobile"></a>
      <nav class="main-nav" aria-label="Main navigation">
        <a href="index.html" class="nav-drawer-brand">Upstate IP Voice</a>
        <ul>
          ${li("solutions.html", "Solutions", "solutions")}
          ${li("about.html", "About Us", "about")}
          ${li("blog.html", "Blog", "blog")}
          ${li("support.html", "Support", "support")}
          <li><a href="support.html#get-support">Contact</a></li>
          <li><a href="https://app.upstateipvoice.com/login" class="nav-cta">Login</a></li>
        </ul>
      </nav>
    </div>
  </header>`;
}

function hero({ titleMain, titleCopy, cta = true, titleTag = "h1", photo = false }) {
  const sectionClass = photo
    ? "hero hero-solutions hero-solutions--pattern hero-solutions--blog"
    : "hero hero-solutions hero-solutions--pattern";
  const imgSrc = photo ? "images/voip-support-team.webp" : "images/textural%20patern.png";
  const imgAlt = photo ? "Upstate IP Voice support team" : "";
  return `
    <section class="${sectionClass}">
      <img
        src="${imgSrc}"
        alt="${imgAlt}"
        class="hero-solutions__hero-img"
        width="${photo ? "1920" : "3344"}"
        height="${photo ? "1080" : "1882"}"
        sizes="100vw"
        loading="eager"
        fetchpriority="high"
        decoding="async"
      >
      <div class="index-hero-video__content hero-solutions__content">
        <${titleTag} class="index-hero-video__title hero-solutions__title">
          <em class="hero-solutions__title-main">${titleMain}</em>
          <span class="hero-solutions__title-copy index-hero-video__text">${titleCopy}</span>
        </${titleTag}>
        ${
          cta
            ? `<a class="index-hero-video__cta hero-solutions__cta" href="/review/">
          <span class="index-hero-video__cta-inner">
            <span class="index-hero-video__cta-row">
              <span class="index-hero-video__cta-text">Request Demo</span>
              <svg class="index-hero-video__cta-arrow" width="20" height="18" viewBox="0 0 19 17" aria-hidden="true" focusable="false">
                <path d="M0 8H18M7 0L18 8M7 16L18 8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="index-hero-video__cta-line" aria-hidden="true"></span>
          </span>
        </a>`
            : ""
        }
      </div>
    </section>`;
}

const articles = [
  {
    file: "blog-setup-new-business-phone-line.html",
    pillar: "IP Phone System",
    pillarHref: "solutions.html#ip-phone-system",
    cardEyebrow: "IP Phone System",
    cardTitle: "How Long Does It Actually Take to Set Up a New Business Phone Line?",
    cardDek: "Minutes with a pre-configured cloud handset - not days waiting on a truck roll.",
    cardImg: "images/index/science-hardware.png",
    cardAlt: "Black IP desk phone handset",
    articleImg: "images/index/ip-phone-comparison-from-design.png",
    articleAlt: "The old way versus the Upstate way on two phones",
    title: "How Long to Set Up a New Business Phone Line | Upstate IP Voice",
    description:
      "See how long it really takes to set up a new business phone line - legacy PBX truck rolls vs. pre-configured cloud handsets that go live in minutes.",
    keywords: "business phone setup, cloud VoIP setup time, new phone line, Upstate NY VoIP, pre-configured IP phone",
    ogTitle: "How Long Does It Actually Take to Set Up a New Business Phone Line?",
    dek: "The old way meant a technician, a truck, and a calendar invite you couldn't move. The new way ships ready to plug in.",
    paragraphs: [
      "Ask most business owners how long it takes to add a phone line and you will hear a familiar story. Someone calls the phone vendor. A technician is scheduled. Hardware shows up - or does not. Someone has to unlock the closet, move cables, and hope the configuration survives the visit. Days pass. The new hire is already answering emails without a real extension.",
      "That model was built for a world where every office ran its own on-premise PBX. The equipment lived in a closet. Changes lived with whoever held the keys. Adding a desk was a project. Moving a desk was another project. Opening a second location meant starting over with another box and another calendar hold you could not move.",
      "Upstate IP Voice was built for the opposite reality. Handsets arrive pre-configured. They sync to the cloud when they power on. Adding a line, moving a station, or standing up a temporary desk is measured in minutes - not service tickets. The phone is ready for your account before the box hits the front desk.",
      "Here is the old way, plainly. You wait for availability. You pay for a truck roll whether the change takes ten minutes or two hours. If the tech cannot finish, you wait again. Meanwhile the new hire is borrowing someone else's extension, or a personal cell is doing double duty as the company line. Customers hear that mismatch even when you try to hide it.",
      "Here is the new way. You order a phone that already knows your account. You plug it into power and network. It pulls its settings from the cloud and joins the same dial plan, voicemail, and call flows your team already uses. No equipment closet. No certification required on your side. No waiting for someone to \"program the box\" while the floor sits half connected.",
      "That speed matters when growth is uneven. Seasonal staff. A pop-up office. A partner who needs a line for thirty days. A remodel that moves the reception desk twice in one quarter. Legacy systems punish that kind of flexibility with fees and delays. Cloud handsets treat it as normal business, not a special project.",
      "Walk through a real Monday morning. A new associate starts at nine. Under the old model you hope the tech finished Friday, or you hand them a spare handset with yesterday's greeting still on it. Under the new model you place a pre-configured set on the desk, they log into the same system the rest of the team uses, and the first inbound call already knows where to land.",
      "Moves tell the same story. Relocating a station used to mean pulling labels, rewiring, and hoping the closet still had a free port. Now the identity lives in the cloud. The handset is an endpoint. Swap the device, keep the extension, keep the hours, keep the voicemail. The business does not pause while plastic catches up to the org chart.",
      "Reliability follows the same split. An on-premise box is a single point of failure for the floor. If it fails, every desk fails with it. A cloud system distributes the work. A handset can be swapped in minutes. A greeting can be updated from a browser. Your number stays put while the hardware under it changes. That is how real offices stay open when something physical breaks.",
      "None of this means phones stopped mattering. Desk sets still matter for front desks, exam rooms, warehouses, and anyone who lives on speakerphone. What changed is who owns the configuration. The cloud does. The phone is the endpoint - not the entire system. That shift is what turns a two-week install into a plug-in afternoon.",
      "Compare the hidden calendar cost, not only the line fee. Truck rolls burn manager time. Missed windows burn hire ramp-up. Temporary cell forwarding burns professionalism. When setup is measured in minutes, those leaks shrink. You spend the week answering customers instead of chasing a technician's ETA.",
      "If you are comparing quotes, ask one practical question: how long until a new line is live without a technician on site? Ask what happens when you need a second phone next month. Ask who updates the greeting when the lobby moves. If the answer still involves a truck for basic changes, you are buying the old model with a new invoice.",
      "Test the claim the same way you would test a new hire's desk. Order the handset. Plug it in. Confirm it joins the dial plan, rings the right people, and drops voicemail where your team already looks. If that path is clean, setup time is no longer a project plan. It is a packing slip and a power cord.",
      "Upstate IP Voice ships that model - pre-configured hardware, cloud sync, and a setup timeline measured in minutes. When you are ready to see how fast a new line can go live for your floor, look at the IP Phone System on our solutions page or book a quick review. Built for real businesses, not legacy telecom systems.",
    ],
  },
  {
    file: "blog-onprem-pbx-vs-cloud-voip.html",
    pillar: "IP Phone System",
    pillarHref: "solutions.html#ip-phone-system",
    cardEyebrow: "IP Phone System",
    cardTitle: "On-Premise PBX vs. Cloud VoIP: What to Know Before Your Next Upgrade",
    cardDek: "One equipment closet can take down the whole office. Cloud voice spreads the risk.",
    cardImg: "images/index/ip-phone-tablet-detail.png",
    cardAlt: "Upstate IP Voice dashboard on a tablet",
    articleImg: "images/index/ip-phone-comparison-from-design.png",
    articleAlt: "The old way versus the Upstate way on two phones",
    title: "On-Premise PBX vs Cloud VoIP Upgrade Guide | Upstate IP Voice",
    description:
      "Compare on-premise PBX and cloud VoIP before your next upgrade - single points of failure, hardware refresh costs, and why cloud voice fits growing Upstate businesses.",
    keywords: "on-premise PBX vs cloud VoIP, PBX upgrade, cloud phone system, business VoIP comparison, Upstate NY",
    ogTitle: "On-Premise PBX vs. Cloud VoIP: What to Know Before Your Next Upgrade",
    dek: "Before you refresh the closet again, weigh the real cost of owning the box versus running voice in the cloud.",
    paragraphs: [
      "An on-premise PBX feels familiar because it has always been there. The lights blink. The closet stays warm. When something breaks, you know where to look - and that is exactly the problem. Familiar is not the same as fit for how your team works now.",
      "One equipment closet is a single point of failure. Power blip, failed board, bad firmware flash, or a cable someone tugged during a renovation - and the whole office goes quiet. Not one desk. Every desk. Customers hear silence while you hunt for the person who last touched the rack.",
      "Hardware refresh costs hide in the same closet. Cards age out. Licenses stack up. Capacity upgrades mean another visit and another invoice. You are not just buying phones. You are buying a mini data center that only does voice, plus the risk that the next upgrade lands on a busy week you cannot spare.",
      "The old way sold control. Own the box. Touch the cables. Keep voice \"in house.\" In practice that control was a tax. Every change waited on a specialist. Every expansion waited on spare ports. Every outage waited on whoever could get to the building. Control without agility is just a warm closet.",
      "Cloud VoIP flips that ownership model. The dial tone, routing, and features live in distributed infrastructure instead of a box under the stairs. Your office still has handsets and headsets. What it does not have is a fragile server that must stay healthy for anyone to take a call. The endpoint is local. The system is not trapped in one room.",
      "That difference shows up during growth. Adding users on a PBX often means checking port counts and spare licenses. Adding users on a cloud system means provisioning another seat and shipping another pre-configured device. The system scales with the business, not with the closet. A second site does not require a second private phone brain.",
      "Disaster recovery is another quiet gap. With on-premise voice, a building issue can take phones offline even when your team can still work elsewhere. With cloud voice, the number follows the ruleset - to a laptop, a mobile app, or a temporary location - without rebuilding the PBX somewhere else. Continuity becomes a setting, not a construction project.",
      "Day-to-day changes tell the same story. Need a new greeting for a holiday week? Update it in the browser. Need to move reception to a different desk? Move the user, not the wiring plan. Need overflow to another team for a promo? Adjust the route once and every device that shares that identity follows. The old way turned those edits into tickets.",
      "Security and updates follow the same pattern. On-premise gear waits for someone to patch it. Skipped updates pile up until a failure forces attention. Cloud platforms push updates centrally. You spend less time babysitting firmware and more time answering customers. The upgrade path is continuous instead of a stressful weekend cutover every few years.",
      "Cost comparisons go wrong when they only line up monthly seat fees. Price the truck rolls. Price the spare cards you might never use. Price the manager hours spent coordinating outages. Price the revenue risk of a full-floor failure on a Monday morning. Cloud voice usually wins when the full picture is on the page - not when only the line item is.",
      "None of this means every legacy system must leave tomorrow. Some offices will run hybrid for a season while numbers move and habits change. It means the next upgrade decision should price risk, not only monthly line cost. Ask what happens if the closet fails. Ask how long a new location takes to stand up. Ask who owns the next hardware refresh.",
      "Also ask how your team actually works. Split sites. Hybrid schedules. Owners who answer from the truck. Staff who bounce between a desk set and a laptop. An on-premise box assumes the building is the center of the universe. Cloud voice assumes the business is. That assumption matches more Upstate companies every year.",
      "A simple scorecard helps. If the closet fails, how many desks go dark? If you hire three people next quarter, what breaks first - ports, licenses, or patience? If you open a temporary space, do you need another private switch or another pre-configured handset? Write the answers down before you sign another refresh quote.",
      "Upstate IP Voice is built for businesses that want those answers to be simple: no closet dependency, no truck roll for basic changes, and phones that sync to the cloud. When you weigh your next upgrade, start with the IP Phone System pillar and map the risk of the closet against a cloud setup that moves with you. Real businesses need voice that keeps working when plans change - not a system that only works when the equipment room cooperates.",
    ],
  },
  {
    file: "blog-one-number-every-device.html",
    pillar: "Our App",
    pillarHref: "solutions.html#our-app",
    cardEyebrow: "Our App",
    cardTitle: "One Number, Every Device: How to Stop Missing Calls When Your Team Isn't at a Desk",
    cardDek: "One ruleset across desk phone, laptop, and mobile - not three disconnected systems.",
    cardImg: "images/index/science-mobile-app.png",
    cardAlt: "Upstate IP Voice mobile app call history screen",
    articleImg: "images/index/our-app-phone.png",
    articleAlt: "Upstate IP Voice mobile app on a smartphone",
    title: "One Business Number on Every Device | Upstate IP Voice",
    description:
      "Stop missing calls when your team leaves the desk. Use one business number and one ruleset across desk phone, laptop, and mobile with Upstate IP Voice.",
    keywords: "one number every device, business mobile app, softphone, cloud VoIP mobile, miss fewer calls",
    ogTitle: "One Number, Every Device: How to Stop Missing Calls When Your Team Isn't at a Desk",
    dek: "People move. Numbers should move with them - without juggling three inboxes and a forwarding maze.",
    paragraphs: [
      "Most missed calls are not about effort. They are about architecture. The desk phone rings in the office. The cell rings a personal number. The laptop has a softphone someone installed once and forgot. Three systems. Three voicemails. One customer who only dialed once and will not try three times to find you.",
      "The old way treated location as destiny. If you were at the desk, you caught the call. If you were in the field, on the floor, or between meetings, the call landed wherever the last forwarding rule pointed - or nowhere useful. People compensated with sticky notes and \"text me if they call.\" That is not a phone strategy. That is hope.",
      "The new way starts with one number and one ruleset. Desk phone, laptop, and mobile share the same identity. Ring order, hours, voicemail, and follow-up live in one place. When the person moves, the rules move with them. The customer still dials the business. Your team still answers as the business - from wherever the work actually is.",
      "That matters for owners who wear five hats. It matters for managers who split time between sites. It matters for technicians, clinicians, salespeople, and anyone who cannot sit next to a desk set from open to close and still be expected to answer as the company. Real schedules are mobile. The number should be too.",
      "A shared ruleset also kills the \"which voicemail did they leave?\" scramble. One inbox. One history. One place to return the call with the company caller ID instead of a personal cell that customers will save forever. Callbacks sound like the brand. Follow-ups stay visible to the team instead of trapped on one person's device.",
      "Picture a normal afternoon. You leave the desk for a site visit. Under the old model the desk rings into emptiness while your cell stays quiet unless someone remembered a forward. Under the new model the same number can ring the desk first, then the app on your phone, then fall to the shared voicemail your team already checks. No scavenger hunt. No \"I thought it was still forwarded.\"",
      "Device freedom without rule discipline creates chaos. Personal cell forwarding feels fast until someone forgets to turn it off, or a weekend rule stays active into Monday. When rules follow the person in the app, you are not relying on memory to keep the business sounding professional. Availability becomes a setting you can see, not a rumor about whose phone is \"on.\"",
      "Caller ID discipline matters as much as ringing. When staff dial out from personal cells, customers store the wrong number. Later calls bypass the business completely. One number on every device keeps outbound identity clean. The relationship stays with the company even when the person is walking to the truck.",
      "There is a culture shift here too. \"I was away from my desk\" stops being an excuse when the desk is no longer the only place the business can reach you. The office phone becomes one endpoint among several - not the entire system. Coverage becomes a team habit supported by design, not heroics from whoever happens to hear the ring.",
      "Training gets simpler when the story is consistent. New hires learn one app, one voicemail, one set of hours - not a private maze of desk codes and personal forwards. Managers can see whether a user is set for desk-only, mobile-first, or simultaneous ring. The ruleset is legible. That alone cuts missed-call arguments.",
      "If your team still explains missed calls with device geography, the system is asking people to compensate for bad design. Fix the design. Put one number on every device your team actually uses, and let the ruleset do the routing work. Effort belongs in the conversation with the customer, not in hunting which device should have rung.",
      "Run a quick audit this week. Call your own main number from outside while a key person is away from the desk. Note what rings, what does not, and where the message lands. Then ask that person which inbox they would check first. If those answers disagree, you are still living in the three-system world.",
      "Close the gap by collapsing identity first. One number. One history. Then set ring order that matches how the day really runs - desk heavy in the morning, mobile heavy in the field, clear after-hours paths when nobody should be disturbed. Adjust once in the cloud. Every device that shares that identity follows.",
      "Upstate IP Voice's app is built for that - one number, every device, and a ruleset that travels with the person. When your team leaves the desk and still needs to answer as the business, start with Our App on the solutions page and see how the same identity rides from handset to laptop to phone. Built for real businesses that leave the desk and still need to answer.",
    ],
  },
  {
    file: "blog-hidden-cost-forwarding-rules.html",
    pillar: "Our App",
    pillarHref: "solutions.html#our-app",
    cardEyebrow: "Our App",
    cardTitle: "The Hidden Cost of a Forwarding Rule Nobody Remembers to Update",
    cardDek: "Stale forwards miss business quietly. Rules that follow the person fix the leak.",
    cardImg: "images/index/our-app-phone.png",
    cardAlt: "Upstate IP Voice mobile app on a smartphone",
    articleImg: "images/index/science-mobile-app.png",
    articleAlt: "Upstate IP Voice mobile app call history screen",
    title: "Hidden Cost of Outdated Call Forwarding Rules | Upstate IP Voice",
    description:
      "Stale call-forwarding rules silently miss business. Learn why device-based forwards fail and how person-based rules in a modern VoIP app stop the leak.",
    keywords: "call forwarding problems, outdated forwarding rules, missed business calls, VoIP mobile app, Upstate IP Voice",
    ogTitle: "The Hidden Cost of a Forwarding Rule Nobody Remembers to Update",
    dek: "A forward that made sense last quarter can still be routing revenue into a dead end today.",
    paragraphs: [
      "Call forwarding is the duct tape of business phones. It works until it does not - and when it fails, it fails quietly. No alarm. No ticket. Just a customer who hears rings into nowhere, a voicemail box nobody checks, or a personal cell that changed hands. The leak does not announce itself. It just costs you.",
      "The hidden cost is not the feature. It is the maintenance model. Someone set a rule for vacation, a job site, or a temporary desk. Then the reason expired and the rule stayed. The system kept doing exactly what it was told. Faithful software plus forgotten intent is how revenue disappears without a dramatic outage.",
      "Device-based forwards are especially fragile. Forward desk to cell. Forward cell to another cell. Chain enough of those and you have a scavenger hunt instead of a phone system. When staffing changes, the scavenger hunt gets worse. New people inherit mysteries. Old people leave with the only map still in their head.",
      "The old way sounded practical in the moment. \"Just forward it to me while I am out.\" That sentence solves today and plants tomorrow's miss. Weeks later nobody remembers who owns the rule. The desk still points somewhere that no longer makes sense. Callers get a professional greeting followed by an unprofessional dead end.",
      "Person-based rules reverse the logic. The identity is the employee or the role - not the plastic on the desk. When that person is available on mobile, the same policy applies. When hours change, you edit one ruleset instead of hunting through handsets. The route travels with the user profile in the cloud, not with a forgotten toggle on one device.",
      "You can spot the old model in the language teams use. \"Just forward it to me.\" \"I think it still goes to the old phone.\" \"We fixed that once.\" Those sentences are warning lights. They mean the business depends on tribal knowledge instead of a living configuration. If three people give three answers about where a call goes, folklore is running your front line.",
      "Missed revenue rarely shows up as a neat report line labeled \"stale forward.\" It shows up as slower callbacks, customers who try a competitor, and staff who assume someone else caught the call. It shows up as personal numbers customers saved by mistake. It shows up as managers who only learn about the miss when a client mentions it weeks later.",
      "Seasonal patterns make the problem worse. Summer hours. Holiday coverage. A contractor who covers Fridays for a month. Each change tempts another temporary forward. Without a home for rules that is easy to review, temporary becomes permanent. The calendar moves on. The route does not.",
      "Cleaning this up is less about a heroic audit and more about changing where rules live. If forwards only exist on individual devices, they will rot. If rules live with the user profile in the cloud app, updates stick and travel. You still need discipline - but the system stops fighting you every time someone leaves the building.",
      "A practical test: pick three people and ask where a call to the main number goes at 10 a.m., 2 p.m., and 7 p.m. If answers disagree, you do not have a communications plan. You have folklore. Write the real path down. Then compare it to what the devices are actually doing. The gap is your silent tax.",
      "Another test is turnover. When someone leaves, how many forwards still mention them? When someone joins, how many places must be touched before their calls behave? If offboarding is a scavenger hunt across desks and cells, person-based routing in the app will pay for itself in avoided misses alone.",
      "Replace chains with clear ring orders. Desk, then mobile, then shared voicemail - or whatever matches your floor. Prefer simultaneous or sequenced ring on one identity over nested forwards across personal numbers. Keep after-hours separate from daytime availability so a weekend exception cannot leak into Monday morning.",
      "Review rules the same way you review schedules. When hours change, open the ruleset. When a role changes, open the ruleset. When a device is replaced, confirm the identity - not a pile of old forwards - is what still drives the call. Make the review boring and frequent. Boring means the leak stays closed.",
      "Upstate IP Voice keeps routing with the person across desk, laptop, and mobile so you are not paying the silent tax of forgotten forwards. If stale rules have been quietly missing business for you, look at Our App and put the ruleset where your team can see it and update it. Real businesses change plans weekly. Their phone rules should keep up without a scavenger hunt.",
    ],
  },
  {
    file: "blog-after-hours-call-flow.html",
    pillar: "Automations",
    pillarHref: "solutions.html#automations",
    cardEyebrow: "Automations",
    cardTitle: "What Happens to a Call After Hours? Building a Flow That Never Goes Unanswered",
    cardDek: "Visual call flows, smart routing, and follow-up so nights and rushes still get handled.",
    cardImg: "images/index/science-automations.png",
    cardAlt: "Upstate IP Voice automations dashboard on laptop",
    articleImg: "images/index/automations-247.png",
    articleAlt: "AI receptionist available 24/7 on mobile",
    title: "After-Hours Call Flow That Never Goes Unanswered | Upstate IP Voice",
    description:
      "Build an after-hours call flow that never goes unanswered - visual routing, smart follow-up, and automations that cover nights, weekends, and rush periods.",
    keywords: "after hours call flow, call routing automation, missed call follow-up, visual call flow, VoIP automations",
    ogTitle: "What Happens to a Call After Hours? Building a Flow That Never Goes Unanswered",
    dek: "Closing time should change the path - not delete the customer.",
    paragraphs: [
      "After hours is when good intentions meet empty desks. The sign on the door says closed. The phone does not know that unless you teach it. If you do not, callers get endless rings, a generic mailbox, or a mobile that buzzes on someone's nightstand with no context. Closing time should change the path - not delete the customer.",
      "The old way was a single greeting and hope. \"Leave a message and we will call you back.\" Some businesses meant it. Others discovered the message on Tuesday. By then the caller had already booked elsewhere. Hope is not a flow. It is a gamble with your reputation after dark.",
      "A modern flow treats after hours as a designed path. Business hours end. The call hits a clear menu or an AI receptionist. Urgent options can reach an on-call person. Routine requests collect details. Missed calls trigger follow-up so nothing sits invisible. The caller still gets a next step even when the lobby lights are off.",
      "Visual call-flow builders matter because phone logic used to live in menus only a vendor could edit. If you cannot see the path, you cannot trust the path. Dragging hours, routes, and outcomes into a flow you can read means your team owns the experience. Changes stop waiting on a ticket to someone who last touched the system months ago.",
      "Rushes are the daytime cousin of after hours. Lunch. Storm days. A promo that works too well. The same automation tools that cover nights can overflow queues, offer callbacks, and keep greetings accurate when humans are slammed. Busy is not the same as closed - but both need a plan that does not depend on heroics.",
      "Unanswered is a process failure, not a personality failure. Staff cannot be everywhere. The system can still acknowledge the caller, capture intent, and route the next step. That is the difference between \"we were busy\" and \"we were prepared.\" Prepared sounds like a business. Busy sounds like a coin flip.",
      "Start with three questions. What should a caller hear when you are closed? Who, if anyone, should be reachable for true emergencies? What happens to every missed call by the next open morning? If any answer is \"it depends,\" write the flow until it does not. Ambiguity at 8 p.m. becomes a missed opportunity by 8 a.m.",
      "Separate urgent from everything else. A true emergency path should be narrow, deliberate, and staffed by people who know they are on call. Everything else can gather a name, a need, and a preferred callback window. Mixing those lanes is how nightstand phones ring for questions that could wait - and how real emergencies get buried in the same pile.",
      "Follow-up is the half of after hours most offices forget. A clean overnight capture means nothing if the morning team does not see it. Build a queue, an email, a task list, or a shared inbox that opens with the day. Automations should hand work to humans in a place humans already work - not hide it in a mailbox nobody opens.",
      "Greetings drift out of date faster than people admit. Holiday hours. Temporary closures. A new location. If the recording still promises same-day returns when you are closed for a week, trust erodes before anyone speaks to a person. Own the greeting the same way you own the website hours. Update both when reality changes.",
      "Then test it like a customer. Call from outside at 8 p.m. Call during a simulated rush. Confirm the recording matches reality. Confirm the on-call path only fires when it should. Confirm the follow-up actually lands where the morning team will see it. Automations only help when they match how the business really runs.",
      "Document the flow in plain language for staff. \"After seven, press one for emergencies, otherwise leave details and we return calls after nine.\" When the team can say the path out loud, they can spot when the live system drifts. Visual builders make that alignment easier because the picture on screen matches the story at the desk.",
      "Review after-hours monthly, not only when something breaks. Look at how many overnight calls you received, how many reached a person, and how fast the rest got a callback. Adjust menus that confuse callers. Tighten emergency criteria that are too loose. Expand capture fields that leave the morning team guessing.",
      "Upstate IP Voice automations are built so after-hours and overflow paths stay visible, editable, and reliable - the same standard you want during open hours. If nights and rushes still fall into a generic mailbox, explore the Automations pillar and map a flow that keeps answering when the lights are off. Built for real businesses that cannot afford a dead line after closing time.",
    ],
  },
  {
    file: "blog-ai-receptionist-vs-answering-service.html",
    pillar: "Automations",
    pillarHref: "solutions.html#automations",
    cardEyebrow: "Automations",
    cardTitle: "AI Receptionist vs. Traditional Answering Service: What Actually Saves Front-Desk Time",
    cardDek: "Routine questions handled automatically - without a relay that still needs callbacks.",
    cardImg: "images/index/automations-247.png",
    cardAlt: "AI receptionist available 24/7 on mobile",
    articleImg: "images/index/science-automations.png",
    articleAlt: "Upstate IP Voice automations dashboard on laptop",
    title: "AI Receptionist vs Answering Service | Upstate IP Voice",
    description:
      "Compare an AI receptionist with a traditional answering service - what saves front-desk time, what still needs a human, and how automations cut routine call load.",
    keywords: "AI receptionist, answering service comparison, front desk phone automation, virtual receptionist, VoIP AI",
    ogTitle: "AI Receptionist vs. Traditional Answering Service: What Actually Saves Front-Desk Time",
    dek: "Front desks drown in repeat questions. The right automation answers those - and leaves people for the work only people can do.",
    paragraphs: [
      "Traditional answering services sell coverage. A human picks up when you cannot. That still helps in some cases. It also introduces a relay: the service takes a message, you call back, and the caller repeats themselves. Time is spent twice. The front desk still inherits a pile of callbacks that feel like unfinished conversations.",
      "An AI receptionist aims at a different job. Handle the routine automatically - hours, directions, common service questions, basic routing - so the front desk is not the bottleneck for information your website already knows. People stay reserved for judgment, empathy, and the calls that actually need a human.",
      "The old way scaled with headcount or overtime. Busy mornings meant longer hold times or missed calls. Hiring another person fixed capacity until the next spike. Paying an outside service fixed nights until every routine question still burned a human minute. The cost curve followed labor, not software.",
      "The new way scales with good flows. Repeat questions get consistent answers at 9 a.m. and 9 p.m. Overflow during a rush gets an orderly path instead of a full voicemail box. Humans step in when judgment, empathy, or complex scheduling is required. Coverage stops meaning \"another body on the line for every ring.\"",
      "Saving front-desk time is measurable. Count how many calls are \"What are your hours?\" \"Do you take new patients?\" \"Where do I park?\" \"Do you offer that service?\" If those dominate the board, a person answering them is expensive automation with a salary. Clear those first and the remaining calls feel like real work again.",
      "Answering services still have a place when every call needs a human touch or when policy requires a live intermediary. The mistake is paying for a human relay on questions a well-built flow can clear in seconds. Use people where people matter. Do not rent people to read the hours aloud.",
      "Compare the handoff quality, not only the pickup rate. A service that answers fast but leaves thin notes still burns your morning. An automated path that captures the right details can hand your team a cleaner start than a vague \"please call Mrs. Smith back.\" Speed without context is only half a win.",
      "Integration matters. A bolted-on service that cannot see your hours, queue, or customer records creates another silo. An AI receptionist inside your phone system can use the same automations, recordings, and routing you already trust. One place to update hours. One place to change menus. One story for every caller.",
      "Staff experience improves when the flood of repeat questions drops. Front-desk people stop sounding rushed on the calls that deserve patience. Managers stop staffing for the worst five minutes of the day across the whole week. The phone system absorbs the repetitive load so humans can do human work.",
      "Evaluate with a simple scorecard. What percentage of calls are identical? How fast should urgent callers reach a person? What must never be automated? Which hours are coverage gaps today? Design for those answers instead of buying a generic \"virtual receptionist\" label that promises everything and clarifies nothing.",
      "Pilot on the loudest repeat topics first. Hours. Directions. Service availability. Basic routing to the right team. Measure how many calls never needed a person. Then decide where a live answering service still earns its keep - if it does - for true after-hours judgment calls. Layer tools. Do not replace thought with a brand name.",
      "Keep an escape hatch to a human that callers can trust. Automation that traps people frustrates them faster than a short hold. The goal is not to hide your team. The goal is to stop spending skilled attention on questions your business already answered yesterday.",
      "Watch the metrics that matter to a front desk. Time to first useful answer. Share of calls resolved without a transfer. Callback volume created by thin messages. Staff minutes recovered in a typical morning. If those numbers move, the tool is doing real work. If they do not, fix the flow before you blame the channel.",
      "Upstate IP Voice pairs automations and AI reception with the same cloud system your team already uses - so front-desk time goes to customers who need a human, not to reading the hours aloud again. When you are ready to cut routine call load without adding another relay, start with the Automations pillar and map which questions should never reach the desk. Built for real businesses, not legacy telecom habits.",
    ],
  },
];

function parasHtml(paragraphs) {
  return paragraphs
    .map((p) => `                <p class="index-science-features__desc index-hero-subtext">${p}</p>`)
    .join("\n");
}

function articlePage(a) {
  const canonical = `https://www.upstateipvoice.com/${a.file}`;
  const ogImage = `https://www.upstateipvoice.com/${a.articleImg.replace(/ /g, "%20")}`;
  return `${head({
    title: a.title,
    description: a.description,
    keywords: a.keywords,
    canonical,
    ogTitle: a.ogTitle,
    ogDescription: a.description,
    ogImage,
    ogType: "article",
  })}
<body class="has-hero" id="top">
${headers("blog")}

  <main aria-label="${a.ogTitle}">
${hero({
  titleMain: a.pillar,
  titleCopy: "Practical notes from Upstate IP Voice - built for real businesses, not legacy telecom systems.",
  cta: true,
  titleTag: "p",
  photo: true,
})}

    <section class="solutions-buckets index-figma__section blog-article" aria-labelledby="blog-article-title">
      <div class="solutions-buckets__inner">
        <div class="solutions-buckets__layout">
          <div class="solutions-buckets__main">
            <header class="solutions-buckets__intro">
              <p class="index-precision__eyebrow">${a.pillar}</p>
              <h1 id="blog-article-title" class="solutions-buckets__intro-title">${a.ogTitle}</h1>
              <p class="solutions-buckets__intro-body index-hero-subtext">${a.dek}</p>
            </header>

            <div class="about-came-from__text blog-article__prose">
${parasHtml(a.paragraphs)}
            </div>

            <div class="blog-article__media">
              <img src="${a.articleImg}" alt="${a.articleAlt}" width="880" height="658" loading="lazy" decoding="async">
            </div>

            <ul class="ip-compare-card__links blog-article__links">
              <li><a href="${a.pillarHref}">${a.pillar}</a></li>
              <li><a href="blog.html">Back to Blog</a></li>
              <li><a href="/review/">Schedule a demo</a></li>
            </ul>
          </div>
${ASIDE}
        </div>
      </div>
    </section>
  </main>

${FOOTER}
  <script src="js/main.js?v=20260813m10"></script>
</body>
</html>
`;
}

function cardHtml(a) {
  return `          <article class="index-science-features__card">
            <div class="index-science-features__media">
              <img src="${a.cardImg}" alt="${a.cardAlt}" width="1254" height="1254" loading="lazy" decoding="async">
            </div>
            <div class="index-science-features__body">
              <p class="index-precision__eyebrow index-science-features__eyebrow">${a.cardEyebrow}</p>
              <h3 class="index-science-features__title">${a.cardTitle}</h3>
              <div class="index-science-features__footer">
                <p class="index-science-features__desc index-hero-subtext">${a.cardDek}</p>
                <a href="${a.file}" class="index-science-features__cta" aria-label="Read ${a.cardTitle}">
                  ${CTA_ARROW}
                </a>
              </div>
            </div>
          </article>`;
}

function blogIndex() {
  const canonical = "https://www.upstateipvoice.com/blog.html";
  return `${head({
    title: "Blog | Upstate IP Voice | Cloud VoIP Insights for Upstate NY Businesses",
    description:
      "Practical guides on cloud VoIP, IP phones, mobile calling, and call automations for small and growing businesses in Upstate NY.",
    keywords: "VoIP blog, cloud phone tips, business phone system, Upstate NY VoIP, call automations, IP phones",
    canonical,
    ogTitle: "Blog | Upstate IP Voice",
    ogDescription:
      "Practical guides on cloud VoIP, IP phones, mobile calling, and call automations for Upstate NY businesses.",
    ogImage: "https://www.upstateipvoice.com/images/voip-support-team.webp",
    ogType: "website",
  })}
<body class="has-hero" id="top">
${headers("blog")}

  <main aria-label="Blog">
${hero({
  titleMain: "Notes for businesses that live on the phone",
  titleCopy:
    "Short, plain-spoken guides on cloud voice, mobile calling, and automations - built around how real Upstate businesses actually work.",
  cta: true,
  photo: true,
})}

    <section class="index-science-features index-science-features--solutions index-figma__section" aria-label="Blog articles">
      <div class="index-science-features__inner">
        <div class="index-science-features__grid">
${articles.map(cardHtml).join("\n")}
        </div>
      </div>
    </section>

    <section class="solutions-buckets index-figma__section" aria-label="Next steps">
      <div class="solutions-buckets__inner">
        <div class="solutions-buckets__layout solutions-buckets__layout--blog-cta">
          <div class="solutions-buckets__main">
            <header class="solutions-buckets__intro">
              <h2 class="solutions-buckets__intro-title">Ready when you are</h2>
              <p class="solutions-buckets__intro-body index-hero-subtext">See the products behind these articles - or book a communications review and we will map the right setup for your team.</p>
            </header>
            <ul class="ip-compare-card__links blog-article__links">
              <li><a href="solutions.html#ip-phone-system">IP Phone System</a></li>
              <li><a href="solutions.html#our-app">Our App</a></li>
              <li><a href="solutions.html#automations">Automations</a></li>
              <li><a href="/review/">Schedule a demo</a></li>
            </ul>
          </div>
${ASIDE}
        </div>
      </div>
    </section>
  </main>

${FOOTER}
  <script src="js/main.js?v=20260813m10"></script>
</body>
</html>
`;
}

function ensureFooterBlog(html, prefix = "") {
  const blogHref = `${prefix}blog.html`;
  if (html.includes(`href="${blogHref}">Blog</a>`)) return html;
  return html.replace(
    new RegExp(`(<li><a href="${prefix}about\\.html">Our Story</a></li>)`),
    `$1\n          <li><a href="${blogHref}">Blog</a></li>`
  );
}

function insertNavBlog(html, prefix = "") {
  if (html.includes(`href="${prefix}blog.html"`)) return html;

  // Mobile menu
  html = html.replace(
    new RegExp(`(<a href="${prefix}about\\.html"[^>]*>About Us</a>\\s*)\\n(\\s*)(<a href="${prefix}support\\.html")`),
    `$1\n$2<a href="${prefix}blog.html">Blog</a>\n$2$3`
  );

  // Desktop nav list
  html = html.replace(
    new RegExp(
      `(<li><a href="${prefix}about\\.html"[^>]*>About Us</a></li>\\s*)\\n(\\s*)(<li><a href="${prefix}support\\.html")`
    ),
    `$1\n$2<li><a href="${prefix}blog.html">Blog</a></li>\n$2$3`
  );

  return html;
}

function patchSiteNavFooter() {
  const rootPages = [
    "index.html",
    "about.html",
    "support.html",
    "solutions.html",
    "privacy.html",
    "acceptable-use-policy.html",
  ];
  for (const file of rootPages) {
    const p = path.join(ROOT, file);
    let html = fs.readFileSync(p, "utf8");
    html = insertNavBlog(html, "");
    html = ensureFooterBlog(html, "");
    fs.writeFileSync(p, html);
    console.log("patched", file);
  }

  const nested = ["privacy-policy/index.html", "terms/index.html"];
  for (const file of nested) {
    const p = path.join(ROOT, file);
    let html = fs.readFileSync(p, "utf8");
    html = insertNavBlog(html, "../");
    html = ensureFooterBlog(html, "../");
    fs.writeFileSync(p, html);
    console.log("patched", file);
  }

  let partial = fs.readFileSync(path.join(ROOT, "partials", "site-footer.html"), "utf8");
  partial = ensureFooterBlog(partial, "");
  fs.writeFileSync(path.join(ROOT, "partials", "site-footer.html"), partial);
  console.log("patched partials/site-footer.html");
}

function patchSitemap() {
  const p = path.join(ROOT, "sitemap.xml");
  let xml = fs.readFileSync(p, "utf8");
  const urls = [
    ["solutions.html", "monthly", "0.9"],
    ["blog.html", "weekly", "0.8"],
    ...articles.map((a) => [a.file, "monthly", "0.7"]),
  ];
  for (const [loc, freq, pri] of urls) {
    const full = `https://www.upstateipvoice.com/${loc}`;
    if (xml.includes(full)) continue;
    const entry = `  <url>
    <loc>${full}</loc>
    <changefreq>${freq}</changefreq>
    <priority>${pri}</priority>
  </url>
`;
    xml = xml.replace("</urlset>", `${entry}</urlset>`);
  }
  fs.writeFileSync(p, xml);
  console.log("patched sitemap.xml");
}

function appendBlogCss() {
  const cssPath = path.join(ROOT, "css", "style.css");
  let css = fs.readFileSync(cssPath, "utf8");
  if (css.includes("/* Blog article - reuse solutions/about patterns */")) return;
  css += `

/* Blog article - reuse solutions/about patterns */
.solutions-buckets__intro .index-precision__eyebrow {
  margin: 0 0 0.75rem;
}

.blog-article__prose {
  max-width: min(720px, 100%);
  margin-bottom: clamp(28px, 3vw, 40px);
}

.blog-article__media {
  margin: 0 0 clamp(24px, 3vw, 36px);
  max-width: min(720px, 100%);
  border-radius: clamp(16px, 1.5vw, 24px);
  overflow: hidden;
  background: #F5F7F9;
}

.blog-article__media img {
  display: block;
  width: 100%;
  height: auto;
}

.blog-article__links {
  margin-top: 0;
  margin-bottom: clamp(16px, 2vw, 24px);
}

@media (max-width: 900px) {
  .solutions-buckets__layout--blog-cta {
    grid-template-columns: 1fr;
  }
}
`;
  fs.writeFileSync(cssPath, css);
  console.log("appended blog CSS");
}

function main() {
  const blogOnly = process.env.BLOG_ONLY === "1";

  if (!blogOnly) {
    appendBlogCss();
  }

  fs.writeFileSync(path.join(ROOT, "blog.html"), blogIndex());
  console.log("wrote blog.html");
  for (const a of articles) {
    fs.writeFileSync(path.join(ROOT, a.file), articlePage(a));
    console.log("wrote", a.file);
  }

  // Re-apply footer from partials/site-footer.html on generated blog pages
  const footerNow = fs.readFileSync(path.join(ROOT, "partials", "site-footer.html"), "utf8").trim();
  for (const file of ["blog.html", ...articles.map((a) => a.file)]) {
    const p = path.join(ROOT, file);
    let html = fs.readFileSync(p, "utf8");
    html = html.replace(/<footer class="site-footer site-footer--figma"[\s\S]*?<\/footer>/, footerNow);
    fs.writeFileSync(p, html);
  }

  if (blogOnly) {
    console.log("done (BLOG_ONLY)");
    return;
  }

  // Refresh footer snippet used in generated pages after partial update
  patchSiteNavFooter();
  // Re-write generated pages with updated footer containing Blog link
  const footerAfterPatch = fs.readFileSync(path.join(ROOT, "partials", "site-footer.html"), "utf8").trim();
  for (const file of ["blog.html", ...articles.map((a) => a.file)]) {
    const p = path.join(ROOT, file);
    let html = fs.readFileSync(p, "utf8");
    html = html.replace(/<footer class="site-footer site-footer--figma"[\s\S]*?<\/footer>/, footerAfterPatch);
    fs.writeFileSync(p, html);
  }
  patchSitemap();
  console.log("done");
}

main();
