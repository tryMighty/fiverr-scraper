# Mighty's Fiverr Scraper v2.0

A highly robust, autonomous browser extension that extracts structured data from Fiverr search results and individual gig/seller profiles. Built to bypass basic bot-detection, this scraper mimics human browsing patterns by autonomously orchestrating tab navigation, allowing React components to fully hydrate before capturing deep DOM metrics.

## Features

- **Tab-Controlled Orchestration:** Opens, scans, and closes gig pages organically in the browser.
- **Deep Profile Extraction:** Automatically clicks "More about me" and resolves truncated bios, fetching granular seller stats (languages, location, join date, multi-tier pricing).
- **React-Hydration Fallbacks:** Extracts data from both live DOM elements and `window.__INITIAL_STATE__` to ensure high data fidelity even when UI components are obscured or minimized.
- **Clean Schema Export:** Normalizes missing scalar fields to `"N/A"` ensuring consistency across datasets. 
- **Live Stream UI:** Glassmorphism dashboard tracks gig extractions in real-time.

---

## Installation

1. Open your Chromium-based browser (Chrome, Edge, Brave, etc.).
2. Navigate to your extensions page: `chrome://extensions/`
3. Enable **Developer Mode** (usually a toggle in the top right corner).
4. Click **Load unpacked**.
5. Select the `Fiverr-Scraper` directory containing this repository.

---

## Usage

1. **Open the extension:** Click the robot icon in your browser's toolbar.
2. **Enter a seed keyword:** E.g., `framer website design`, `adyen`, `copywriting`.
3. **Select Mode:** Leave `Autonomous Mode` toggled ON to allow the scraper to control the active tab.
4. **Initialize Engine:** Click the start button.
5. **Wait for Extraction:** The scraper will automatically:
   - Navigate to the Fiverr homepage.
   - Fetch related keyword dropdown suggestions.
   - Iterate through the queued keywords, opening search result pages.
   - Open individual gig and seller profile tabs to extract deep metrics.
6. **Download:** Once the process completes (or if you click "Terminate & Save"), a `[keyword]-fiverr-data.json` file will automatically download to your machine.

---

## Output Data Structure

The extension outputs a structured JSON file containing all metadata and extracted gigs.

```json
{
  "meta": {
    "exportedAt": "2026-05-14T00:00:00.000Z",
    "seedKeyword": "adyen",
    "allKeywords": ["adyen"],
    "totalKeywords": 1,
    "totalGigs": 1
  },
  "results": [
    {
      "keyword": "adyen",
      "totalGigs": 1,
      "gigs": [
        {
          "keyword": "adyen",
          "rank": 1,
          "gigUrl": "https://www.fiverr.com/username/do-payment-integration",
          "gig": {
            "title": "I will integrate adyen, stripe, paypal in your website",
            "description": "I will integrate leading payment gateways such as Adyen, Stripe, and PayPal into your Next.js application...",
            "image": "https://fiverr-res.cloudinary.com/images/.../image.png",
            "rating": "5.0",
            "reviewsCount": "12",
            "extractedUsername": "username",
            "packages": [
              {
                "tier": "Basic",
                "name": "Basic Integration",
                "description": "Integration of 1 payment gateway",
                "price": "$50",
                "delivery": "3 Days Delivery",
                "revisions": "1 Revision",
                "features": ["Source code", "Documentation"]
              },
              {
                "tier": "Standard",
                "name": "Standard Integration",
                "description": "Integration of 2 payment gateways",
                "price": "$100",
                "delivery": "5 Days Delivery",
                "revisions": "3 Revisions",
                "features": ["Source code", "Documentation", "Testing"]
              }
            ],
            "faq": [
              {
                "q": "Do you provide testing credentials?",
                "a": "Yes, I will use sandbox credentials during development."
              }
            ]
          },
          "seller": {
            "username": "username",
            "publicName": "John Doe",
            "sellerLevel": "Level 2 Seller",
            "rating": "5.0",
            "reviewsCount": "145",
            "about": "I am a senior full-stack developer with 5+ years of experience...",
            "skills": ["React", "Next.js", "Payment Gateway Integration", "Node.js"],
            "education": ["B.Sc. in Computer Science"],
            "certifications": [],
            "courses": [],
            "languages": [
              {
                "language": "English",
                "level": "Fluent"
              },
              {
                "language": "Spanish",
                "level": "Basic"
              }
            ],
            "memberSince": "Dec 2021",
            "country": "United States"
          }
        }
      ]
    }
  ]
}
```

---

## Important Considerations

- **Bot Protection:** Do not run multiple instances of this scraper concurrently on the same IP, as Fiverr's security layers may eventually throttle your requests.
- **Tab Focus:** The scraper operates best when the window remains in focus. Minimizing the browser or switching away during the run may interrupt React DOM hydration and result in empty fields.
