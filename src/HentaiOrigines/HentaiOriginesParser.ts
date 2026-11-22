import { MangaDistrictParser } from '../MangaDistrict/MangaDistrictParser'

export class HentaiOriginesParser extends MangaDistrictParser {
  constructor(baseUrl: string) {
    super(baseUrl, {
      archivePath: 'catalogue',
      seriesPath: 'manga',
      genrePath: 'manga-genre',
      sourceName: 'Hentai Origines',
      langCode: 'fr',
      hentai: true,
      acceptWordPressReaderImages: true,
      modernChapterContainerClass: 'ori-chl-row',
      modernChapterDateClass: 'ori-chl-date',
      modernAuthorLabel: 'Scénario',
      modernArtistLabel: 'Dessin'
    })
  }
}
