import { MangaDistrictParser } from '../MangaDistrict/MangaDistrictParser'

export class MangasOriginesParser extends MangaDistrictParser {
  constructor(baseUrl: string) {
    super(baseUrl, {
      archivePath: 'catalogues',
      seriesPath: 'oeuvre',
      genrePath: 'manga-genres',
      sourceName: 'Mangas Origines',
      langCode: 'fr',
      hentai: false,
      acceptWordPressReaderImages: true
    })
  }
}
