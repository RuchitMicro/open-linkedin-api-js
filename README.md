# linkedin-api.js

> A universal JavaScript port of the [`open-linkedin-api`](https://github.com/tomquirk/linkedin-api) Python library.  
> Runs anywhere JavaScript runs — Node.js, Chrome Extensions, browser scripts, and service workers.

<br>

**Created by [Ruchit Kharwa](https://wolfx.io) · [WOLFx Digital](https://wolfx.io)**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)]()

---

## Table of Contents

- [Why](#why)
- [Installation](#installation)
- [Usage by Environment](#usage-by-environment)
- [API Reference](#api-reference)
  - [Constructor](#constructor)
  - [Profile](#profile)
  - [Search](#search)
  - [Posts & Feed](#posts--feed)
  - [Company](#company)
  - [Messaging](#messaging)
  - [Connections & Invitations](#connections--invitations)
  - [Jobs](#jobs)
- [Cookie Persistence](#cookie-persistence)
- [Notes & Disclaimers](#notes--disclaimers)
- [Contributing](#contributing)
- [License](#license)

---

## Why

The original `open-linkedin-api` is Python-only. This library brings the exact same functionality to the JavaScript ecosystem — with zero dependencies, zero build steps, and zero configuration. Drop a single `.js` file into your project and you're good to go, whether you're writing a Node.js backend, a Chrome extension, or a plain browser script.

---

## Installation

No package manager required. Just copy `linkedin-api.js` into your project.

```bash
# Or clone the repo
git clone https://github.com/wolfx-digital/linkedin-api-js.git
```

---

## Usage by Environment

### Node.js (CommonJS)
```js
const { Linkedin } = require('./linkedin-api');

const api = new Linkedin('you@email.com', 'password', { debug: true });
await api.init(); // authenticate once

const profile = await api.getProfile({ publicId: 'satya-nadella' });
console.log(profile);
```

### Node.js / Bundler (ES Module)
```js
import Linkedin from './linkedin-api.js';

const api = new Linkedin('you@email.com', 'password');
await api.init();
```

### Browser (Script Tag)
```html
<script src="linkedin-api.js"></script>
<script>
  const api = new LinkedinAPI.Linkedin('you@email.com', 'password');
  await api.init();
</script>
```

### Chrome Extension (Background Service Worker)
```js
// background.js
importScripts('linkedin-api.js');

const api = new self.LinkedinAPI.Linkedin('you@email.com', 'password');
await api.init();
// Cookies are auto-persisted via chrome.storage.local
```

### Chrome Extension (Content Script)
```js
// content.js — inject linkedin-api.js via manifest first
const api = new LinkedinAPI.Linkedin('you@email.com', 'password');
await api.init();
```

---

## API Reference

### Constructor
```js
const api = new Linkedin(username, password, {
  authenticate: true,       // auto-authenticate on init()
  refreshCookies: false,    // force fresh login, ignore cache
  debug: false,             // enable verbose logging
  cookies: null,            // pass pre-existing cookie jar object
  cookiesDir: '',           // (Node.js only) cookie storage directory
});
await api.init(); // REQUIRED before calling any method
```

---

### Profile

```js
// Fetch full profile
await api.getProfile({ publicId: 'john-doe' });
await api.getProfile({ urnId: 'ACoAA...' });

// Contact info (email, phone, websites)
await api.getProfileContactInfo({ publicId: 'john-doe' });

// Skills
await api.getProfileSkills({ publicId: 'john-doe' });

// Experience (GraphQL, richer data)
await api.getProfileExperiences('urnId123');

// Connections
await api.getProfileConnections('urnId123');

// Network info (follower count, distance, etc.)
await api.getProfileNetworkInfo('john-doe');

// Privacy settings
await api.getProfilePrivacySettings('john-doe');

// Member badges
await api.getProfileMemberBadges('john-doe');

// Current user
await api.getUserProfile();

// Profile view count (own account)
await api.getCurrentProfileViews();

// Remove a connection
await api.removeConnection('john-doe'); // returns true on error

// Unfollow an entity
await api.unfollowEntity('urnId123');   // returns true on error
```

---

### Search

```js
// Search people
await api.searchPeople({
  keywords: 'product designer',
  networkDepths: ['F', 'S'],       // F=1st, S=2nd, O=3rd+
  currentCompany: ['1234', '5678'],
  regions: ['103644278'],          // geo URN IDs
  industries: ['4'],               // industry URN IDs
  keywordTitle: 'Designer',
  keywordCompany: 'Figma',
  includePrivateProfiles: false,
  limit: 50,
  offset: 0,
});

// Search companies
await api.searchCompanies({ keywords: 'UI/UX design studio', limit: 20 });

// Search jobs
await api.searchJobs({
  keywords: 'frontend engineer',
  locationName: 'San Francisco, CA',
  jobType: ['F'],           // F=full-time, C=contract, P=part-time, T=temp, I=internship
  experience: ['3', '4'],   // 1=internship...6=executive
  remote: ['2'],            // 1=onsite, 2=remote, 3=hybrid
  listedAt: 86400,          // seconds (86400 = last 24h)
  limit: 25,
});
```

---

### Posts & Feed

```js
// Get posts from a profile
await api.getProfilePosts({ publicId: 'john-doe', postCount: 20 });

// Get comments on a post
await api.getPostComments('postUrnId', { commentCount: 50 });

// Get reactions on a post
await api.getPostReactions('urnId', { maxResults: 100 });

// React to a post (LIKE, PRAISE, APPRECIATION, EMPATHY, INTEREST, ENTERTAINMENT)
await api.reactToPost('postUrnId', { reactionType: 'LIKE' });

// Chronological feed
await api.getFeedPosts({ limit: 20, excludePromotedPosts: true });

// Profile updates / activity
await api.getProfileUpdates({ publicId: 'john-doe', maxResults: 50 });
```

---

### Company

```js
// Get company data
await api.getCompany('anthropic');

// Get school data
await api.getSchool('mit');

// Follow/unfollow company
await api.followCompany('followingStateUrn', { following: true });

// Company news/updates
await api.getCompanyUpdates({ publicId: 'anthropic', maxResults: 20 });
```

---

### Messaging

```js
// Get conversation with a specific person
await api.getConversationDetails('profileUrnId');

// List all conversations
await api.getConversations();

// Get messages in a conversation
await api.getConversation('conversationUrnId');

// Send a message to existing conversation
await api.sendMessage({ messageBody: 'Hey!', conversationUrnId: 'abc123' });

// Send a message to new recipients
await api.sendMessage({ messageBody: 'Hey!', recipients: ['urnId1', 'urnId2'] });

// Mark as read
await api.markConversationAsSeen('conversationUrnId');
```

---

### Connections & Invitations

```js
// Get pending invitations
await api.getInvitations({ start: 0, limit: 10 });

// Accept / reject invitation
await api.replyInvitation('invitationUrn', 'sharedSecret', { action: 'accept' });
await api.replyInvitation('invitationUrn', 'sharedSecret', { action: 'reject' });

// Send connection request
await api.addConnection('john-doe', { message: 'Hi John, love your work!' });
```

---

### Jobs

```js
// Get a specific job posting
await api.getJob('3894460323');

// Get required skills for a job
await api.getJobSkills('3894460323');
```

---

## Cookie Persistence

Cookies are cached automatically per environment with no extra configuration:

| Environment | Storage |
|---|---|
| Node.js | `os.tmpdir()/linkedin_cookies_<username>.json` |
| Chrome Extension | `chrome.storage.local` |
| Browser | `localStorage` |

Pass `refreshCookies: true` to force a fresh login and overwrite the cache.

---

## Notes & Disclaimers

- All methods are `async` and return Promises.
- A random 2–5 second delay is applied between requests to reduce detection risk.
- LinkedIn's internal Voyager API is undocumented and may change without notice. If something breaks, please open an issue.
- **This library is intended for personal use, research, and automation of your own LinkedIn account.** Use responsibly and in full accordance with [LinkedIn's Terms of Service](https://www.linkedin.com/legal/user-agreement). The authors accept no liability for misuse.

---

## Contributing

Contributions are welcome and appreciated! This is an open-source project maintained by the community. Please read the rules below before submitting anything.

### How to Contribute

1. **Fork** the repository and create your branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** — keep them focused and minimal. One feature or fix per PR.

3. **Test your changes** manually across at least one environment (Node.js preferred).

4. **Commit** using a clear, descriptive message:
   ```bash
   git commit -m "feat: add getProfileRecommendations method"
   ```
   We follow [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`, `refactor`, `chore`.

5. **Push** your branch and open a Pull Request against `main`.

---

### Contribution Rules

These rules exist to keep the codebase clean, safe, and maintainable.

**Code Quality**
- Keep everything in the single-file architecture (`linkedin-api.js`). Do not introduce build tools, bundlers, or transpilers without prior discussion in an issue.
- Write vanilla JavaScript only — no TypeScript, no frameworks, no external dependencies. Zero-dependency is a core design goal.
- Follow the existing code style: 2-space indentation, `camelCase` for methods and variables, JSDoc comments for all public methods.
- All new API methods must mirror the Python `open-linkedin-api` method naming convention (converted to camelCase) where applicable.

**Pull Requests**
- PRs must have a clear title and description explaining *what* was changed and *why*.
- Link to any relevant issue in the PR description (`Closes #42`).
- PRs that only fix formatting or add comments without a functional change will not be merged unless the cleanup is significant.
- Do not submit PRs that change unrelated parts of the code. Keep diffs tight.
- Breaking changes must be discussed in an issue first before a PR is opened.

**Issues**
- Before opening an issue, search existing issues to avoid duplicates.
- Bug reports must include: environment (Node.js version / browser / extension), a minimal code snippet to reproduce the issue, and the error output.
- Feature requests should explain the use case, not just the desired API surface.

**What We Won't Accept**
- PRs that introduce spam, scraping, or automation tools targeting other users without consent.
- Any code that harvests or stores user data from LinkedIn beyond what is needed for the immediate API call.
- Hardcoded credentials, API keys, or tokens of any kind.
- Changes that break existing API compatibility without a major version bump discussion.

---

### Maintainers

| Name | Role | Links |
|---|---|---|
| Ruchit Kharwa | Creator & Lead Maintainer | [wolfx.io](https://wolfx.io) |

Built with ❤️ by **[WOLFx Digital](https://wolfx.io)**

---

## License

MIT © [Ruchit Kharwa](https://wolfx.io) / [WOLFx Digital](https://wolfx.io)

See [LICENSE](LICENSE) for full text.# open-linkedin-api-js
