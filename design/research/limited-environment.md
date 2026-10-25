# How file previews show an HTML file

Reader: whoever changes the limited-environment warning ([../output/instrument.md](../output/instrument.md#a-limited-environment), `src/ui/limited.js`).

**Bottom line.** No preview gives the page what it needs to work fully: storage for the autosave, downloads for Save and Export, and workers. Where a preview runs the page at all, it runs it in a sandboxed frame, usually without `allow-same-origin`. That gives the page an **opaque origin** and **no storage**. Some previews add a policy that also forbids **workers** and network connections. Others run **no script** and show the file as text or offer a download. The reliable sign is an opaque origin in a frame (or served from a site), and storage that throws. A download block can be read only where the parent is same-origin. Missing storage alone is not a sign, since a private window or a browser setting causes it too.

## SharePoint Online and OneDrive

Two different paths, depending on where the file is:

- **A document library (Documents, OneDrive).** SharePoint Online enforces *Strict* browser file handling, and admins cannot change it. `.html` and `.htm` files are served as downloads (`Content-Disposition: attachment`): "*.htm and *.html files in document libraries no longer open in the browser. Users are prompted to download the files." ([Microsoft, Migration assessment: browser file handling](https://learn.microsoft.com/sharepointmigration/migration-assessment-scan-browser-file-handling)). Custom script (NoScript) is off by default on modern sites and OneDrive. Some users then see a preview pane that shows only the file name ([Comma, a third party, not confirmed by Microsoft](https://commareports.com/sharepoint-html-preview)). On this path the page runs nowhere: the file is downloaded and opened locally, which is the full environment.
- **HTML pages (Site Pages, "Allow HTML files", rolling out).** SharePoint "renders HTML in a sandboxed iframe that isolates the page" from the site around it. "Content Security Policy (CSP) rules provide extra isolation." "The sandbox supports JavaScript when the code is contained in the same HTML file". JavaScript from a CDN is not supported, except for a few libraries Microsoft hosts. Arbitrary fetch requests and outbound API calls are blocked. The sandbox cannot access localStorage. Pages are limited to 10 MB ([Microsoft Support, HTML pages in SharePoint](https://support.microsoft.com/en-us/sharepoint/create-edit-publish-html-pages)). An independent write-up quotes parts of the policy: `connect-src 'none'`, `frame-src 'none'`, `worker-src 'none'`. It says the frame has "no browser storage" and that links are intercepted ([spdenis.com, SharePoint HTML pages, what they can and cannot do](https://spdenis.com/sharepoint-html-pages-what-they-can-and-cannot-do/)).

Not found published: the exact `sandbox` flags. "No storage" implies no `allow-same-origin`, so the origin is opaque. Whether `allow-downloads` is set is not published either. Our page is 0.7 MB, under the 10 MB limit. Its web font cannot load there and falls back to system fonts.

## Teams, Outlook, Google Drive

- **Teams** opens files through the SharePoint or OneDrive that stores them (a chat's files live in OneDrive, a channel's in SharePoint). The rules above apply ([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/2200388/how-can-i-open-outlook-attachments-in-teams)).
- **Outlook on the web** previews some attachment types. Others must be downloaded first ([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1182887/how-to-resolve-no-previewer-available-for-html-mai)). For `.html`, nothing authoritative says whether it renders. Treat it as a download or a preview without scripts.
- **Google Drive and Gmail** show an HTML file as source text, not as a page. The advice is to download it and open it in a browser ([University of Michigan IT](https://teamdynamix.umich.edu/TDClient/30/Portal/KB/Article/12404/Google-HTML-Email-Attachments-in-Gmail-on-the-Web-Display-As-Raw-Code)). No script runs there, so only the static warning could show, and only if the HTML were rendered at all.

## What a sandbox does to the page, measured

Headless Chromium with this repository's `tools/limited-check.mjs`; the page served over HTTP.

| Frame | Origin | localStorage | Blob worker | Downloads readable | Verdict |
|---|---|---|---|---|---|
| `sandbox="allow-scripts"` | opaque (`null`) | throws | made and runs | no (cross-origin parent) | limited: sandbox, storage |
| the same, with `worker-src 'none'` (as SharePoint's) | opaque | throws | made, then fails (asynchronously, no throw) | no | limited: sandbox, storage, workers |
| `sandbox="allow-scripts allow-same-origin allow-downloads"` | the site's | works | works | yes, allowed | full |
| no JavaScript | — | — | — | — | the static warning |

A file opened directly (`file://`) also has an opaque origin in Chromium and Firefox, but it is the page's own window. So an opaque origin counts only in a frame, or when the page is served from a site, which is how a `Content-Security-Policy: sandbox` response looks.

## Sources

- [Microsoft: Migration assessment scan, browser file handling](https://learn.microsoft.com/sharepointmigration/migration-assessment-scan-browser-file-handling)
- [Microsoft Support: Create, upload, edit, and publish HTML pages in SharePoint](https://support.microsoft.com/en-us/sharepoint/create-edit-publish-html-pages)
- [spdenis.com: SharePoint HTML pages, what they can and cannot do](https://spdenis.com/sharepoint-html-pages-what-they-can-and-cannot-do/)
- [Comma: SharePoint and OneDrive won't open your HTML file](https://commareports.com/sharepoint-html-preview) (a vendor's account)
- [Microsoft Q&A: open Outlook attachments in Teams](https://learn.microsoft.com/en-us/answers/questions/2200388/how-can-i-open-outlook-attachments-in-teams)
- [Microsoft Q&A: "no previewer available" for HTML mail attachments](https://learn.microsoft.com/en-us/answers/questions/1182887/how-to-resolve-no-previewer-available-for-html-mai)
- [University of Michigan IT: HTML attachments in Gmail display as raw code](https://teamdynamix.umich.edu/TDClient/30/Portal/KB/Article/12404/Google-HTML-Email-Attachments-in-Gmail-on-the-Web-Display-As-Raw-Code)
