const axios = require('axios');
const cheerio = require('cheerio');

function getHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  };
}

function normalizeSnap(snap, source) {
  const mediaType = snap.snapMediaType === 1 ? 'video' : 'image';
  const mediaUrl = snap.snapUrls?.mediaUrl || '';
  const thumbnailUrl =
    mediaType === 'video'
      ? snap.snapUrls?.mediaPreviewUrl?.value || ''
      : mediaUrl;

  return {
    id: snap.snapId?.value || snap.timestamp || Math.random().toString(36).slice(2),
    source,
    mediaType,
    mediaUrl,
    thumbnailUrl,
    timestamp: snap.timestampInSec?.value
      ? parseInt(snap.timestampInSec.value) * 1000
      : null,
    duration: snap.duration || null,
    title: snap.title || null,
  };
}

async function fetchStories(username) {
  const url = `https://story.snapchat.com/s/${encodeURIComponent(username)}`;

  let html;
  try {
    const response = await axios.get(url, {
      headers: getHeaders(),
      timeout: 15000,
      validateStatus: () => true,
    });
    html = response.data;
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error('Request timed out.');
    }
    throw new Error(`Network error: ${err.message}`);
  }

  const $ = cheerio.load(html);
  const nextDataEl = $('#__NEXT_DATA__');
  if (!nextDataEl.length) {
    throw new Error(
      'Could not load story data. Snapchat may have changed their page.'
    );
  }

  let nextData;
  try {
    nextData = JSON.parse(nextDataEl.html());
  } catch {
    throw new Error(
      'Could not load story data. Snapchat may have changed their page.'
    );
  }

  const pageProps = nextData?.props?.pageProps;
  if (!pageProps) {
    throw new Error(
      'Could not load story data. Snapchat may have changed their page.'
    );
  }

  // Not found
  const status = pageProps.status;
  const pageType = pageProps.pageType;
  if (status === 2 || pageType === 'NOT_FOUND') {
    throw new Error('User not found on Snapchat.');
  }

  // Profile info
  const userProfile = pageProps.userProfile || pageProps.story?.userProfile || null;
  if (!userProfile) {
    throw new Error("This account's stories are private.");
  }

  // Story snaps (active 24h)
  const storySnaps = (pageProps.story?.snapList || []).map((s) =>
    normalizeSnap(s, 'story')
  );

  // Curated highlights
  const highlightSnaps = (pageProps.curatedHighlights || []).flatMap(
    (highlight) =>
      (highlight.snapList || []).map((s) => ({
        ...normalizeSnap(s, 'highlight'),
        collectionTitle: highlight.title || null,
      }))
  );

  // Spotlight clips
  const spotlightSnaps = (pageProps.spotlightHighlights || []).flatMap(
    (clip) =>
      (clip.snapList || []).map((s) => ({
        ...normalizeSnap(s, 'spotlight'),
        collectionTitle: clip.title || null,
      }))
  );

  const allSnaps = [...storySnaps, ...highlightSnaps, ...spotlightSnaps];

  if (allSnaps.length === 0) {
    throw new Error('No public stories found.');
  }

  return {
    userProfile: {
      username: username,
      displayName: userProfile.publicProfileInfo?.title || username,
      avatarUrl:
        userProfile.publicProfileInfo?.snapcodeImageUrl ||
        userProfile.profilePictureUrl ||
        null,
      subscriberCount:
        userProfile.publicProfileInfo?.subscriberCount || null,
      bio: userProfile.publicProfileInfo?.bio || null,
    },
    stories: storySnaps,
    highlights: highlightSnaps,
    spotlight: spotlightSnaps,
    allSnaps,
  };
}

module.exports = { fetchStories, getHeaders };
