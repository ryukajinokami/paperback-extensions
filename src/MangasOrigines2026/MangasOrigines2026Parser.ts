import { MangaDistrictParser } from '../MangaDistrict/MangaDistrictParser'

export class MangasOrigines2026Parser extends MangaDistrictParser {
  constructor(baseUrl: string) {
    super(baseUrl, {
      archivePath: 'catalogues',
      seriesPath: 'oeuvre',
      genrePath: 'manga-genres',
      sourceName: 'Mangas Origines - 2026',
      langCode: 'fr',
      hentai: false,
      acceptWordPressReaderImages: true,
      modernChapterContainerClass: 'ori-chl-row',
      modernChapterDateClass: 'ori-chl-date',
      modernAuthorLabel: 'Scénario',
      modernArtistLabel: 'Dessin'
    })
  }
}
