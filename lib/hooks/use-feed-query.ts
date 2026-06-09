import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo } from 'react';

import { authApi, feedApi, followsApi, postsApi, userApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { FEED_DEFAULT_PAGE_SIZE, FEED_INTEGRATION_CONFIG } from '@/lib/feed-config';
import { feedTelemetry } from '@/lib/feed-telemetry';
import { warmFeedWindow } from '@/lib/feed-window-warmup';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { FeedApiResponse, FeedPagination, Post, UserPreferenceHint } from '@/types';
import { normalizePost } from '@/lib/utils/normalize-post';
import { isNetworkError } from '@/lib/utils/network-error-handler';
import { filterFeedPlayable, filterSecondarySurfacePosts } from '@/lib/utils/post-filter';

type FeedTab = 'foryou' | 'following';
type FeedEndpoint = 'public' | 'personalized' | 'following' | 'catalog';
type FeedLoadOutcome = 'success' | 'empty' | 'error' | 'degraded';

const FEED_CACHE_KEY_PREFIX = 'talentix:feed-cache:v2';
const FEED_CACHE_MAX_PAGES = 8;
const FEED_CACHE_MAX_POSTS_PER_PAGE = 40;

type UseFeedQueryOptions = {
  refreshSeed?: number;
  limit?: number;
  followedUsersReady?: boolean;
  followedUsersCount?: number;
  followedUserIds?: Iterable<string>;
};

type FeedPageParam = {
  page: number;
  cursor?: string | null;
};

interface FeedPage {
  posts: Post[];
  nextCursor: string | null;
  requestIndex: number;
  hasNext: boolean;
  endpoint: FeedEndpoint;
  refresh: number | null;
  pipeline?: string;
  legacyPipeline: boolean;
  userPreferences: UserPreferenceHint[];
  cached: boolean;
  pagination?: Partial<FeedPagination>;
  loadOutcome: FeedLoadOutcome;
  errorMessage?: string;
  followingEmptyReason?: 'not-following-anyone' | 'no-posts-from-following';
}

function createFeedRequestError(message: string, extras?: Record<string, unknown>) {
  const error = new Error(message) as Error & Record<string, unknown>;
  Object.assign(error, extras);
  return error;
}

function isSuccessfulFeedResponse(response: FeedApiResponse): response is Extract<FeedApiResponse, { status: 'success' }> {
  return response?.status === 'success' && !!response?.data;
}

function extractPosts(raw: any): Post[] {
  if (Array.isArray(raw?.data?.posts)) return raw.data.posts;
  if (Array.isArray(raw?.data?.data?.posts)) return raw.data.data.posts;
  if (Array.isArray(raw?.posts)) return raw.posts;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function extractFollowingUsers(raw: any): string[] {
  const following = raw?.data?.following;
  if (!Array.isArray(following)) {
    return [];
  }

  return following
    .map((item: any) => item?.following?.id || item?.id || null)
    .filter((id: string | null): id is string => !!id);
}

function getPostAuthorId(post: any): string | null {
  return post?.user?.id || post?.user_id || post?.userId || post?.author?.id || null;
}

function markTrustedFollowingPosts(posts: Post[], followedUserIds: Set<string>) {
  return posts
    .filter((post) => {
      const authorId = getPostAuthorId(post);
      return !!authorId && followedUserIds.has(authorId);
    })
    .map((post) => ({ ...post, is_following_author: true }));
}

function extractApprovedPosts(raw: any): Post[] {
  if (Array.isArray(raw?.data?.posts)) return raw.data.posts;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.posts)) return raw.posts;
  return [];
}

function sortFeedPostsByLikesThenRecent(posts: Post[]) {
  return [...posts].sort((a, b) => {
    const aLikes = Number((a as any).likes ?? (a as any).like_count ?? 0);
    const bLikes = Number((b as any).likes ?? (b as any).like_count ?? 0);
    if (bLikes !== aLikes) {
      return bLikes - aLikes;
    }

    const aTime = new Date(a.createdAt || (a as any).created_at || (a as any).uploadDate || 0).getTime();
    const bTime = new Date(b.createdAt || (b as any).created_at || (b as any).uploadDate || 0).getTime();
    return bTime - aTime;
  });
}

function normalizeForYouPosts(rawPosts: any[]) {
  return filterFeedPlayable(rawPosts.map((post) => normalizePost(post)));
}

type CachedFeedPayload = {
  savedAt: number;
  pages: FeedPage[];
};

function getFeedCacheKey(tab: FeedTab, userId: string) {
  return `${FEED_CACHE_KEY_PREFIX}:${tab}:${userId || 'guest'}`;
}

function asCachedFeedPage(page: FeedPage): FeedPage {
  return {
    ...page,
    legacyPipeline: page.legacyPipeline ?? false,
    cached: true,
    loadOutcome: page.posts.length > 0 ? 'degraded' : page.loadOutcome,
    errorMessage: undefined,
  };
}

async function readCachedFeedPage(
  tab: FeedTab,
  userId: string,
  requestIndex: number,
  allowedFollowingAuthorIds?: Set<string>,
): Promise<FeedPage | null> {
  try {
    const raw = await AsyncStorage.getItem(getFeedCacheKey(tab, userId));
    if (!raw) {
      return null;
    }

    const payload = JSON.parse(raw) as Partial<CachedFeedPayload>;
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];
    const page = pages.find((item) => item?.requestIndex === requestIndex) ?? (requestIndex === 1 ? pages[0] : null);
    if (!page || !Array.isArray(page.posts) || page.posts.length === 0) {
      return null;
    }

    const cachedPage = asCachedFeedPage(page);
    if (tab !== 'following') {
      return cachedPage;
    }

    if (!allowedFollowingAuthorIds || allowedFollowingAuthorIds.size === 0) {
      return null;
    }

    const trustedPosts = markTrustedFollowingPosts(cachedPage.posts, allowedFollowingAuthorIds);
    if (trustedPosts.length === 0) {
      return null;
    }

    return {
      ...cachedPage,
      posts: trustedPosts,
      hasNext: false,
      nextCursor: null,
      endpoint: 'following',
    };
  } catch {
    return null;
  }
}

async function persistFeedPages(tab: FeedTab, userId: string, pages: FeedPage[]) {
  try {
    const cacheablePages = pages
      .filter((page) => Array.isArray(page.posts) && page.posts.length > 0)
      .slice(0, FEED_CACHE_MAX_PAGES)
      .map((page) => ({
        ...page,
        posts: page.posts.slice(0, FEED_CACHE_MAX_POSTS_PER_PAGE),
        cached: false,
      }));

    if (cacheablePages.length === 0) {
      return;
    }

    await AsyncStorage.setItem(getFeedCacheKey(tab, userId), JSON.stringify({
      savedAt: Date.now(),
      pages: cacheablePages,
    } satisfies CachedFeedPayload));
  } catch {
    // Feed cache is best-effort only.
  }
}

function mergeUniquePosts(primary: Post[], fallback: Post[]) {
  const seen = new Set<string>();
  const merged: Post[] = [];

  [...primary, ...fallback].forEach((post) => {
    if (!post?.id || seen.has(post.id)) {
      return;
    }

    seen.add(post.id);
    merged.push(post);
  });

  return merged;
}

function extractHasNextFromPagination(pagination: any, requestIndex: number, returnedCount: number, limit: number) {
  if (typeof pagination?.hasNext === 'boolean') return pagination.hasNext;
  if (typeof pagination?.has_next === 'boolean') return pagination.has_next;
  if (typeof pagination?.hasNextPage === 'boolean') return pagination.hasNextPage;
  if (typeof pagination?.has_next_page === 'boolean') return pagination.has_next_page;

  const totalPages = Number(pagination?.totalPages ?? pagination?.total_pages ?? 0);
  if (Number.isFinite(totalPages) && totalPages > 0) {
    return requestIndex < totalPages;
  }

  const totalCount = Number(pagination?.totalCount ?? pagination?.total_count ?? pagination?.total ?? 0);
  if (Number.isFinite(totalCount) && totalCount > 0) {
    return requestIndex * limit < totalCount;
  }

  return returnedCount >= limit;
}

function detectLegacyPipeline(data: any, nextCursor: string | null) {
  const pipeline = typeof data?.feed_meta?.pipeline === 'string' ? data.feed_meta.pipeline : undefined;
  return nextCursor !== null || (typeof pipeline === 'string' && pipeline !== 'tiktok-lite');
}

async function refreshAuthTokenForFeed() {
  const refreshToken = await AsyncStorage.getItem('talynk_refresh_token');
  if (!refreshToken) {
    return false;
  }

  const response = await authApi.refresh(refreshToken);
  if (response.status !== 'success' || !response.data?.accessToken) {
    return false;
  }

  await AsyncStorage.setItem('talynk_token', response.data.accessToken);
  return true;
}

function sanitizeUserPreferences(raw: unknown): UserPreferenceHint[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => ({
      category: typeof item?.category === 'string' ? item.category : '',
      score: typeof item?.score === 'number' ? item.score : Number(item?.score ?? 0),
    }))
    .filter((item) => item.category.length > 0 && Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);
}

function countAdPosts(posts: Post[]) {
  return posts.filter((item: any) => item?.is_ad === true || item?.isAd === true).length;
}

function buildCatalogFallbackPage(args: {
  raw: any;
  requestIndex: number;
  limit: number;
  refreshSeed?: number;
}): FeedPage {
  const { raw, requestIndex, limit, refreshSeed } = args;
  const rawPosts = extractPosts(raw);
  const posts = normalizeForYouPosts(rawPosts);
  const pagination = raw?.data?.pagination ?? raw?.pagination ?? {};
  const hasNext = extractHasNextFromPagination(pagination, requestIndex, rawPosts.length, limit);

  primePostDetailsCache(posts);
  if (requestIndex === 1 && posts.length > 0) {
    warmFeedWindow(posts, 0, { radius: { forward: 2, backward: 0 } });
  }

  feedTelemetry.trackFeedRequest({
    endpoint: 'catalog',
    refresh: refreshSeed ?? undefined,
    fingerprintPresent: true,
    pipeline: 'catalog-fallback',
    countryPersonalization: null,
    adImpressionsCount: countAdPosts(posts),
  });

  return {
    posts,
    nextCursor: hasNext ? String(requestIndex + 1) : null,
    requestIndex,
    hasNext,
    endpoint: 'catalog',
    refresh: refreshSeed ?? null,
    pipeline: 'catalog-fallback',
    legacyPipeline: true,
    userPreferences: [],
    cached: false,
    pagination,
    loadOutcome: posts.length > 0 ? 'degraded' : 'empty',
  };
}

async function loadCatalogFeedPage(requestIndex: number, limit: number, refreshSeed?: number): Promise<FeedPage> {
  const catalog = await postsApi.getAll(requestIndex, limit, {
    featured_first: 'false',
    status: 'active',
  });

  if (catalog.status !== 'success') {
    const message = catalog.message || 'Failed to load fallback feed';
    throw createFeedRequestError(message, {
      endpoint: 'catalog',
      loadOutcome: 'error' as FeedLoadOutcome,
    });
  }

  return buildCatalogFallbackPage({
    raw: catalog,
    requestIndex,
    limit,
    refreshSeed,
  });
}

function mergePrimaryWithCatalog(primaryPage: FeedPage, catalogPage: FeedPage): FeedPage {
  const mergedPosts = mergeUniquePosts(primaryPage.posts, catalogPage.posts);
  return {
    ...primaryPage,
    posts: mergedPosts,
    hasNext: primaryPage.hasNext || catalogPage.hasNext,
    nextCursor: primaryPage.nextCursor ?? catalogPage.nextCursor,
    pipeline: primaryPage.pipeline ?? 'catalog-supplement',
    loadOutcome: primaryPage.loadOutcome === 'success'
      ? 'success'
      : (mergedPosts.length > 0 ? 'degraded' : catalogPage.loadOutcome),
    pagination: primaryPage.pagination ?? catalogPage.pagination,
  };
}

function keepForYouPageContinuable(page: FeedPage): FeedPage {
  if (page.posts.length === 0) {
    return page;
  }

  // Catalog responses carry accurate pagination — never override hasNext there.
  if (page.endpoint === 'catalog' || page.pipeline === 'catalog-fallback') {
    return page;
  }

  // Primary tiktok-lite feed often returns hasNext:false while more posts exist.
  return {
    ...page,
    hasNext: true,
  };
}

async function supplementForYouWithCatalog(
  primaryPage: FeedPage,
  requestIndex: number,
  limit: number,
  refreshSeed?: number,
): Promise<FeedPage> {
  const catalogPage = await loadCatalogFeedPage(requestIndex, limit, refreshSeed);

  if (requestIndex === 1 && primaryPage.posts.length > 0) {
    return keepForYouPageContinuable(mergePrimaryWithCatalog(primaryPage, catalogPage));
  }

  return keepForYouPageContinuable(catalogPage);
}

function normalizeFeedPage(args: {
  response: Extract<FeedApiResponse, { status: 'success' }>;
  endpoint: 'public' | 'personalized';
  requestIndex: number;
  limit: number;
  refreshSeed?: number;
}): FeedPage {
  const { response, endpoint, requestIndex, limit, refreshSeed } = args;
  const data = response.data ?? {};
  const rawPosts = Array.isArray(data.posts) ? data.posts : [];
  const posts = normalizeForYouPosts(rawPosts);
  const pagination = response.pagination ?? {};
  const nextCursor = typeof data.nextCursor === 'string' && data.nextCursor.length > 0 ? data.nextCursor : null;
  const legacyPipeline = detectLegacyPipeline(data, nextCursor);
  const hasNext =
    legacyPipeline && nextCursor !== null
      ? true
      : extractHasNextFromPagination(pagination, requestIndex, rawPosts.length, limit);
  const userPreferences = sanitizeUserPreferences((data as any).userPreferences);
  const refresh = typeof data.refresh === 'number' ? data.refresh : refreshSeed ?? null;
  const pipeline = typeof data.feed_meta?.pipeline === 'string' ? data.feed_meta.pipeline : undefined;

  primePostDetailsCache(posts);

  feedTelemetry.trackFeedRequest({
    endpoint,
    refresh: refresh ?? undefined,
    fingerprintPresent: endpoint === 'public',
    pipeline,
    countryPersonalization: null,
    adImpressionsCount: countAdPosts(posts),
  });

  if (requestIndex === 1) {
    feedTelemetry.trackPersonalizedFeedLoaded({
      endpoint,
      refresh: refresh ?? undefined,
      preferenceCount: userPreferences.length,
      topCategoryName: userPreferences[0]?.category ?? null,
      postsCount: posts.length,
      adCount: countAdPosts(posts),
      pipeline,
      cached: response.cached === true,
    });
  }

  return {
    posts,
    nextCursor,
    requestIndex,
    hasNext,
    endpoint,
    refresh,
    pipeline,
    legacyPipeline,
    userPreferences,
    cached: response.cached === true,
    pagination,
    loadOutcome: posts.length > 0 ? 'success' : 'empty',
  };
}

async function loadFallbackFollowingFeed(
  viewerUserId: string,
  page: number,
  limit: number,
  knownFollowingUserIds?: Set<string>,
): Promise<FeedPage> {
  const followingUserIds = knownFollowingUserIds && knownFollowingUserIds.size > 0
    ? Array.from(knownFollowingUserIds)
    : extractFollowingUsers(await followsApi.getFollowingUsers(viewerUserId, 1, 200));
  const trustedFollowingUserIds = new Set(followingUserIds);

  if (followingUserIds.length === 0) {
    return {
      posts: [],
      nextCursor: null,
      requestIndex: page,
      hasNext: false,
      endpoint: 'following',
      refresh: null,
      userPreferences: [],
      cached: false,
      loadOutcome: 'empty',
      followingEmptyReason: 'not-following-anyone',
      legacyPipeline: true,
    };
  }

  const approvedResponses = await Promise.all(
    followingUserIds.map((followedUserId) => userApi.getUserApprovedPosts(followedUserId, 1, 50)),
  );

  const merged = new Map<string, Post>();

  approvedResponses.forEach((response) => {
    const approvedPosts = markTrustedFollowingPosts(
      extractApprovedPosts(response).map((post: any) => normalizePost(post)),
      trustedFollowingUserIds,
    );

    filterSecondarySurfacePosts(approvedPosts).forEach((post) => {
      if (post?.id && !merged.has(post.id)) {
        merged.set(post.id, post);
      }
    });
  });

  const sortedPosts = sortFeedPostsByLikesThenRecent(Array.from(merged.values()));
  primePostDetailsCache(sortedPosts);

  const start = (page - 1) * limit;
  const pagePosts = sortedPosts.slice(start, start + limit);
  const hasNext = start + limit < sortedPosts.length;

  return {
    posts: pagePosts,
    nextCursor: hasNext ? String(page + 1) : null,
    requestIndex: page,
    hasNext,
    endpoint: 'following',
    refresh: null,
    userPreferences: [],
    cached: false,
    loadOutcome: pagePosts.length > 0 ? 'degraded' : 'empty',
    followingEmptyReason: pagePosts.length > 0 ? undefined : 'no-posts-from-following',
    legacyPipeline: true,
  };
}

function shouldUseRecommendationsFallback(error: unknown, response?: FeedApiResponse) {
  const status = (error as any)?.response?.status;
  const message = String(
    (response as any)?.message ||
      (error as any)?.response?.data?.message ||
      (error as any)?.message ||
      '',
  ).toLowerCase();

  if (status === 404 || status === 405 || status === 410 || status === 501) {
    return true;
  }

  return /not found|not available|unsupported|deprecated/i.test(message);
}

async function loadForYouFeedPage(args: {
  isAuthenticated: boolean;
  requestIndex: number;
  cursor?: string | null;
  limit: number;
  refreshSeed?: number;
}): Promise<FeedPage> {
  const { isAuthenticated, requestIndex, cursor, limit, refreshSeed } = args;
  const homeOptions = {
    limit,
    refresh: refreshSeed,
  };
  const legacyOptions = {
    cursor: cursor || undefined,
    limit,
    refresh: refreshSeed,
  };
  const requestOptions = cursor ? legacyOptions : homeOptions;

  let endpoint: 'public' | 'personalized' = isAuthenticated ? 'personalized' : 'public';
  let response: FeedApiResponse;
  let requestError: unknown = null;

  try {
    response = isAuthenticated
      ? await feedApi.getPersonalized(requestOptions)
      : await feedApi.getPublic(requestOptions);
  } catch (error: any) {
    if (isAuthenticated && error?.response?.status === 401) {
      const refreshed = await refreshAuthTokenForFeed().catch(() => false);
      if (refreshed) {
        response = await feedApi.getPersonalized(requestOptions);
      } else {
        endpoint = 'public';
        response = await feedApi.getPublic(requestOptions);
      }
    } else {
      requestError = error;
      response = {
        status: 'error',
        message: error?.response?.data?.message || error?.message || 'Failed to load feed',
      };
    }
  }

  if (isSuccessfulFeedResponse(response)) {
    const primaryPage = normalizeFeedPage({
      response,
      endpoint,
      requestIndex,
      limit,
      refreshSeed,
    });

    const primaryExhausted =
      !primaryPage.hasNext ||
      primaryPage.posts.length < limit ||
      primaryPage.posts.length === 0;

    if (FEED_INTEGRATION_CONFIG.enableCatalogFeedFallback && primaryExhausted) {
      try {
        return await supplementForYouWithCatalog(primaryPage, requestIndex, limit, refreshSeed);
      } catch (catalogError: any) {
        feedTelemetry.trackFeedNetworkError({
          endpoint: 'catalog',
          message: catalogError?.message || 'Failed to supplement For You feed',
        });
        if (primaryPage.posts.length > 0) {
          return keepForYouPageContinuable(primaryPage);
        }
      }
    }

    return primaryPage;
  }

  if (isAuthenticated && shouldUseRecommendationsFallback(requestError, response)) {
    try {
      const recommendations = await feedApi.getRecommendations(requestOptions);
      if (isSuccessfulFeedResponse(recommendations)) {
        return keepForYouPageContinuable(normalizeFeedPage({
          response: recommendations,
          endpoint: 'personalized',
          requestIndex,
          limit,
          refreshSeed,
        }));
      }
    } catch {
      // Fall through to configured fallback handling.
    }
  }

  if (FEED_INTEGRATION_CONFIG.enableCatalogFeedFallback) {
    try {
      return keepForYouPageContinuable(await loadCatalogFeedPage(requestIndex, limit, refreshSeed));
    } catch (catalogError: any) {
      feedTelemetry.trackFeedNetworkError({
        endpoint: 'catalog',
        message: catalogError?.message || 'Failed to load fallback feed',
      });
    }
  }

  const message = response?.message || (requestError as any)?.message || 'Failed to load feed';
  if (requestError && isNetworkError(requestError)) {
    feedTelemetry.trackFeedNetworkError({ endpoint, message });
  }
  throw createFeedRequestError(message, {
    endpoint,
    loadOutcome: 'error' as FeedLoadOutcome,
  });
}

export function useFeedQuery(tab: FeedTab, options: UseFeedQueryOptions = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = !!user;
  const userId = isAuthenticated && user?.id ? user.id : 'guest';
  const refreshSeed = options.refreshSeed;
  const feedLimit = options.limit ?? FEED_DEFAULT_PAGE_SIZE;
  const followedUserIdSet = useMemo(
    () => new Set(Array.from(options.followedUserIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)),
    [options.followedUserIds],
  );
  const followedUsersSignature = useMemo(
    () => Array.from(followedUserIdSet).sort().join(','),
    [followedUserIdSet],
  );
  const followingEmptyReason =
    tab === 'following' &&
    isAuthenticated &&
    options.followedUsersReady === true &&
    options.followedUsersCount === 0
      ? 'not-following-anyone' as const
      : undefined;

  const queryKey = tab === 'foryou'
    ? ['feed', tab, userId, refreshSeed]
    : ['feed', tab, userId, followingEmptyReason ?? 'active', followedUsersSignature];

  const query = useInfiniteQuery<FeedPage>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      if (tab === 'following') {
        if (!isAuthenticated) {
          return {
            posts: [],
            nextCursor: null,
            requestIndex: 1,
            hasNext: false,
            endpoint: 'following',
            refresh: null,
            userPreferences: [],
            cached: false,
            loadOutcome: 'empty',
            legacyPipeline: true,
          } satisfies FeedPage;
        }

        if (followingEmptyReason === 'not-following-anyone') {
          return {
            posts: [],
            nextCursor: null,
            requestIndex: 1,
            hasNext: false,
            endpoint: 'following',
            refresh: null,
            userPreferences: [],
            cached: false,
            loadOutcome: 'empty',
            followingEmptyReason,
            legacyPipeline: true,
          } satisfies FeedPage;
        }

        const currentParam = (pageParam as FeedPageParam | undefined) ?? { page: 1 };
        const page = Number(currentParam.page || 1);
        const followingLimit = 20;
        const resolveTrustedFollowingUserIds = async () => {
          if (followedUserIdSet.size > 0 || options.followedUsersReady === true) {
            return followedUserIdSet;
          }

          try {
            return new Set(extractFollowingUsers(await followsApi.getFollowingUsers(user!.id, 1, 200)));
          } catch (error) {
            feedTelemetry.trackFeedNetworkError({
              endpoint: 'following',
              message: (error as any)?.message || 'Failed to verify followed users',
            });
            return followedUserIdSet;
          }
        };
        const trustedFollowingUserIds = await resolveTrustedFollowingUserIds();
        const loadCachedFollowingPage = () => readCachedFeedPage(tab, userId, page, trustedFollowingUserIds);

        if (trustedFollowingUserIds.size === 0) {
          return {
            posts: [],
            nextCursor: null,
            requestIndex: page,
            hasNext: false,
            endpoint: 'following',
            refresh: null,
            userPreferences: [],
            cached: false,
            loadOutcome: 'empty',
            followingEmptyReason: 'not-following-anyone',
            legacyPipeline: true,
          } satisfies FeedPage;
        }

        let raw: any;
        try {
          raw = await postsApi.getFollowing(page, followingLimit, 'newest');
        } catch (error: any) {
          feedTelemetry.trackFeedNetworkError({
            endpoint: 'following',
            message: error?.message || 'Failed to load following feed',
          });
          const fallbackPage = await loadFallbackFollowingFeed(user!.id, page, followingLimit, trustedFollowingUserIds);
          if (fallbackPage.posts.length > 0 || fallbackPage.followingEmptyReason) {
            return fallbackPage;
          }
          const cachedPage = await loadCachedFollowingPage();
          if (cachedPage) {
            return cachedPage;
          }
          throw createFeedRequestError(error?.message || 'Failed to load following feed', {
            endpoint: 'following',
            loadOutcome: 'error' as FeedLoadOutcome,
          });
        }

        if (raw.status !== 'success') {
          const message = raw.message || 'Failed to load following feed';
          feedTelemetry.trackFeedNetworkError({ endpoint: 'following', message });
          const fallbackPage = await loadFallbackFollowingFeed(user!.id, page, followingLimit, trustedFollowingUserIds);
          if (fallbackPage.posts.length > 0 || fallbackPage.followingEmptyReason) {
            return fallbackPage;
          }
          const cachedPage = await loadCachedFollowingPage();
          if (cachedPage) {
            return cachedPage;
          }
          throw createFeedRequestError(message, {
            endpoint: 'following',
            loadOutcome: 'error' as FeedLoadOutcome,
          });
        }

        const allPosts = markTrustedFollowingPosts(extractPosts(raw), trustedFollowingUserIds);

        primePostDetailsCache(allPosts);

        const filteredPosts = sortFeedPostsByLikesThenRecent(
          filterSecondarySurfacePosts(allPosts.map((post) => normalizePost(post))),
        );
        if (filteredPosts.length === 0) {
          const fallbackPage = await loadFallbackFollowingFeed(user!.id, page, followingLimit, trustedFollowingUserIds);
          if (fallbackPage.posts.length > 0) {
            return fallbackPage;
          }
          const cachedPage = await loadCachedFollowingPage();
          if (cachedPage) {
            return cachedPage;
          }
          return fallbackPage;
        }

        const pagination = raw?.data?.pagination;
        const hasNext = pagination?.hasNext ?? (allPosts.length >= followingLimit);
        const followingPage: FeedPage = {
          posts: filteredPosts,
          nextCursor: hasNext ? String(page + 1) : null,
          requestIndex: page,
          hasNext,
          endpoint: 'following',
          refresh: null,
          userPreferences: [],
          cached: false,
          pagination,
          loadOutcome: 'success',
          legacyPipeline: true,
        };

        return followingPage;
      }

      const currentParam = (pageParam as FeedPageParam | undefined) ?? { page: 1 };
      const requestIndex = Number(currentParam.page || 1);
      let page: FeedPage;
      try {
        page = await loadForYouFeedPage({
          isAuthenticated,
          requestIndex,
          cursor: currentParam.cursor,
          limit: feedLimit,
          refreshSeed,
        });
      } catch (error) {
        const cachedPage = await readCachedFeedPage(tab, userId, requestIndex);
        if (cachedPage) {
          return cachedPage;
        }
        throw error;
      }
      if (page.posts.length === 0) {
        const cachedPage = await readCachedFeedPage(tab, userId, requestIndex);
        if (cachedPage) {
          return cachedPage;
        }
      }
      if (requestIndex === 1 && page.posts.length > 0) {
        warmFeedWindow(page.posts, 0, { radius: { forward: 2, backward: 0 } });
      }
      return page;
    },
    initialPageParam: { page: 1, cursor: null } as FeedPageParam,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasNext) {
        return undefined;
      }

      return {
        page: lastPage.requestIndex + 1,
        cursor: lastPage.legacyPipeline ? lastPage.nextCursor : null,
      } satisfies FeedPageParam;
    },
    placeholderData: (prev: any) => prev,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    retry: 2,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
  });

  const firstPage = query.data?.pages[0];
  const loadOutcome: FeedLoadOutcome = query.isError ? 'error' : firstPage?.loadOutcome ?? 'empty';
  const errorMessage = query.error instanceof Error ? query.error.message : undefined;

  const flattenedPosts = useMemo(
    () => query.data?.pages.flatMap((page) => page.posts) ?? [],
    [query.data],
  );

  const posts = useMemo(() => {
    const seen = new Set<string>();
    return flattenedPosts.filter((post) => {
      if (!post?.id || seen.has(post.id)) {
        return false;
      }
      seen.add(post.id);
      return true;
    });
  }, [flattenedPosts]);

  useEffect(() => {
    if (tab !== 'foryou' || flattenedPosts.length === 0) {
      return;
    }

    const uniqueIds = new Set(flattenedPosts.map((post) => post.id).filter(Boolean));
    const duplicateRatio = 1 - uniqueIds.size / flattenedPosts.length;
    feedTelemetry.trackDuplicateRatio({
      endpoint: firstPage?.endpoint === 'public' ? 'public' : 'personalized',
      refresh: firstPage?.refresh ?? refreshSeed,
      duplicateRatio: Number.isFinite(duplicateRatio) ? duplicateRatio : 0,
      totalItems: flattenedPosts.length,
      uniqueItems: uniqueIds.size,
    });
  }, [firstPage?.endpoint, firstPage?.refresh, flattenedPosts, refreshSeed, tab]);

  useEffect(() => {
    if (!query.data?.pages?.some((page) => page.posts.length > 0)) {
      return;
    }

    void persistFeedPages(tab, userId, query.data.pages);
  }, [query.data?.pages, tab, userId]);

  const endpoint = firstPage?.endpoint ?? (tab === 'following' ? 'following' : isAuthenticated ? 'personalized' : 'public');

  useEffect(() => {
    if (query.isLoading || query.isRefetching) {
      return;
    }

    if (query.isError) {
      feedTelemetry.trackFeedFirstPageOutcome({
        endpoint,
        outcome: 'error',
        message: errorMessage,
        postsCount: 0,
      });
      return;
    }

    if (!firstPage || firstPage.requestIndex !== 1) {
      return;
    }

    feedTelemetry.trackFeedFirstPageOutcome({
      endpoint,
      outcome: firstPage.loadOutcome,
      message: firstPage.errorMessage,
      postsCount: firstPage.posts.length,
    });
  }, [endpoint, errorMessage, firstPage, query.isError, query.isLoading, query.isRefetching]);

  const hardRefetch = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
    return query.refetch();
  }, [query, queryClient, queryKey]);

  return {
    posts,
    userPreferences: firstPage?.userPreferences ?? [],
    effectiveRefresh: firstPage?.refresh ?? refreshSeed ?? null,
    feedPipeline: firstPage?.pipeline,
    feedEndpoint: firstPage?.endpoint === 'following' ? null : firstPage?.endpoint ?? null,
    feedCached: firstPage?.cached ?? false,
    loadOutcome,
    followingEmptyReason: firstPage?.followingEmptyReason ?? followingEmptyReason ?? null,
    errorMessage,
    queryKey,
    hardRefetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: !!query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    isError: query.isError,
  };
}
