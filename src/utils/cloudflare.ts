export function isCloudflareChallenge(html: string): boolean {
  return /<title[^>]*>\s*(?:just a moment|un instant|attention required|v[ée]rification de s[ée]curit[ée])/i.test(html)
    || /(?:id|class)=["'][^"']*(?:challenge-running|cf-challenge-running)/i.test(html)
    || /window\._cf_chl_opt\s*=/i.test(html)
    || /\/cdn-cgi\/challenge-platform\/[^"']*\/orchestrate\//i.test(html)
}
