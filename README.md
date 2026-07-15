# Paperback Manga Sources

Paperback v0.8 source repository for multiple manga scan sites.

This repository targets `@paperback/types` and `@paperback/toolchain` `0.8.0-alpha.38`. If your Paperback 0.8.x setup requires a different alpha, update both Paperback packages together.

## Sources

- Omega Scans: https://omegascans.org
- MangaDistrict: https://mangadistrict.com

Both sources are marked `ADULT`.

## Support Matrix: Omega Scans

Implemented:

- Series search through the OmegaScans catalogue API.
- Search by title, alternative name, author/studio text handled by `query_string`.
- Genre tags through `getSearchTags()`.
- Tag exclusion for the current result page.
- Search fields for type, status, ordering field and ordering direction.
- Comic and novel series metadata.
- Series details: title, cover, description, genres, status, author, artist/studio, rating.
- Free chapter list.
- Comic reader pages from the public chapter HTML.
- Best-effort novel text chapters rendered as SVG data-image pages.
- Homepage sections: latest comics, latest novels, weekly trending, daily trending, most viewed.
- Share URLs.
- Stable manga/chapter IDs based on OmegaScans slugs for tracker compatibility.
- Network error handling with explicit HTTP and JSON errors.

Intentionally not implemented:

- Login.
- Premium chapter purchase or unlock state.
- Paid/premium chapter pages.
- Account bookmarks, likes, comments or ratings.
- Native tracker implementation. Paperback/external trackers can still match by stable IDs and chapter numbers.

Notes:

- OmegaScans is an adult source, so this extension is marked `ADULT`.
- Premium chapters are filtered out of the chapter list unless OmegaScans exposes them as free.
- Paperback v0.8 chapter content is image-page based. OmegaScans novels are text HTML, so novel chapters are converted to SVG `data:image/svg+xml` pages as a best-effort compatibility layer.
- Search operators are not advertised because the OmegaScans API does not expose reliable AND/OR operator controls. Multiple included genre tags are sent to the site as `tags_ids=[...]`.

## Support Matrix: MangaDistrict

Implemented:

- Series search through the public WordPress/Madara pages.
- Genre tags from the MangaDistrict archive page.
- Tag inclusion through Madara genre query parameters.
- Tag exclusion by filtering the current result page against each series details page.
- Search field for ordering.
- Series details: title, cover, description, genres, status, author, artist and rating when exposed.
- Public chapter list from `wp-manga-chapter` entries.
- Reader pages from `reading-content` / `wp-manga-chapter-img`.
- Filtering of logos, thumbnails, generic splash images, ads and non-reader images.
- Homepage sections: latest updates, most viewed, trending, new series and highest rated.
- Share URLs.
- Stable manga/chapter IDs based on MangaDistrict slugs for tracker compatibility.
- Network error handling with explicit HTTP errors.

Intentionally not implemented:

- Login.
- Premium or account-only content.
- Account bookmarks, likes, comments or ratings.
- Native tracker implementation. Paperback/external trackers can still match by stable IDs and chapter numbers.

Notes:

- MangaDistrict is a Madara/WordPress site. Public HTML selectors can change without API versioning.
- Chapter IDs use the `chapter-*` slug from URLs like `/series/{slug}/chapter-1/`.
- The reader parser keeps only CDN page URLs under `/publication/.../chapter-*`.

## Search Fields

Paperback v0.8 search fields are plain text fields. Use these optional values:

Omega Scans:

- `Type`: `Comic`, `Novel`, or `All`.
- `Status`: `All`, `Ongoing`, `Completed`, `Hiatus`, or `Dropped`.
- `Order by`: `updated_at`, `created_at`, `total_views`, `title`, `rating`, or `latest`.
- `Order`: `asc` or `desc`.

MangaDistrict:

- `Order by`: `modified`, `views`, `trending`, `rating`, `new-manga`, `alphabet`, or `relevance`.

## Build

```bash
npm install
npm run typecheck
npm run build
```

The build creates `bundles/`, including:

- `bundles/OmegaScans/index.js`
- `bundles/OmegaScans/source.js`
- `bundles/MangaDistrict/index.js`
- `bundles/MangaDistrict/source.js`
- `bundles/versioning.json`
- `bundles/index.html`

## Publish on GitHub Pages

```bash
git init
git add .
git commit -m "Add Paperback manga sources"
git branch -M main
git remote add origin https://github.com/<your-github-username>/<your-repository-name>.git
git push -u origin main
```

Then enable GitHub Pages:

1. Open the GitHub repository settings.
2. Go to Pages.
3. Set the source to GitHub Actions.
4. The included workflow builds the extension and deploys `bundles/`.
5. The Paperback repository URL should point to the deployed Pages root.

## Add in Paperback v0.8

After deployment, add this repository URL in Paperback:

```text
https://<your-github-username>.github.io/<your-repository-name>
```

If you deploy the contents of `bundles/` under a subfolder, use that subfolder URL instead.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
