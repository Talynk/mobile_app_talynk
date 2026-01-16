import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface UserPreferences {
  theme: "light" | "dark";
  autoplay: boolean;
  dataUsage: "low" | "medium" | "high";
  notifications: {
    likes: boolean;
    comments: boolean;
    follows: boolean;
    posts: boolean;
  };
  contentFilters: string[];
  language: string;
}

interface CacheContextType {
  preferences: UserPreferences;
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  likedPosts: Set<string>;
  followedUsers: Set<string>;
  postLikeCounts: Map<string, number>;
  updateLikedPosts: (postId: string, isLiked: boolean) => void;
  updateFollowedUsers: (userId: string, isFollowing: boolean) => void;
  updatePostLikeCount: (postId: string, count: number) => void;
  syncLikedPostsFromServer: (postIds: string[]) => Promise<void>;
  clearCache: () => Promise<void>;
}

const defaultPreferences: UserPreferences = {
  theme: "dark",
  autoplay: true,
  dataUsage: "medium",
  notifications: {
    likes: true,
    comments: true,
    follows: true,
    posts: true,
  },
  contentFilters: [],
  language: "en",
};

const CacheContext = createContext<CacheContextType | undefined>(undefined);

export const CacheProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [preferences, setPreferences] =
    useState<UserPreferences>(defaultPreferences);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [followedUsers, setFollowedUsers] = useState<Set<string>>(new Set());
  const [postLikeCounts, setPostLikeCounts] = useState<Map<string, number>>(
    new Map()
  );

  // -------------------------------------------------------
  // LOAD FROM STORAGE
  // -------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const [prefsData, likedData, followedData, likeCountsData] =
          await Promise.all([
            AsyncStorage.getItem("user_preferences"),
            AsyncStorage.getItem("liked_posts"),
            AsyncStorage.getItem("followed_users"),
            AsyncStorage.getItem("post_like_counts"),
          ]);

        if (prefsData) {
          setPreferences({
            ...defaultPreferences,
            ...JSON.parse(prefsData),
            notifications: {
              ...defaultPreferences.notifications,
              ...(JSON.parse(prefsData).notifications || {}),
            },
          });
        }

        if (likedData) {
          const arr = JSON.parse(likedData);
          if (Array.isArray(arr)) setLikedPosts(new Set(arr));
        }

        if (followedData) {
          const arr = JSON.parse(followedData);
          if (Array.isArray(arr)) setFollowedUsers(new Set(arr));
        }

        if (likeCountsData) {
          const obj = JSON.parse(likeCountsData);
          setPostLikeCounts(new Map(Object.entries(obj)));
        }
      } catch (e) {
        console.error("Error loading cache:", e);
      }
    })();
  }, []);

  // -------------------------------------------------------
  // UPDATE PREFS (DEEP MERGE)
  // -------------------------------------------------------
  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    const merged = {
      ...preferences,
      ...updates,
      notifications: {
        ...preferences.notifications,
        ...(updates.notifications || {}),
      },
    };

    setPreferences(merged);

    try {
      await AsyncStorage.setItem("user_preferences", JSON.stringify(merged));
    } catch (err) {
      console.error("Error saving preferences:", err);
    }
  };

  // -------------------------------------------------------
  // LIKED POSTS
  // -------------------------------------------------------
  const updateLikedPosts = (postId: string, isLiked: boolean) => {
    setLikedPosts((prev) => {
      const updated = new Set(prev);
      isLiked ? updated.add(postId) : updated.delete(postId);

      (async () => {
        await AsyncStorage.setItem(
          "liked_posts",
          JSON.stringify(Array.from(updated))
        );
      })();

      return updated;
    });
  };

  // -------------------------------------------------------
  // LIKE COUNTS
  // -------------------------------------------------------
  const updatePostLikeCount = (postId: string, count: number) => {
    setPostLikeCounts((prev) => {
      const updated = new Map(prev);
      updated.set(postId, count);

      (async () => {
        await AsyncStorage.setItem(
          "post_like_counts",
          JSON.stringify(Object.fromEntries(updated))
        );
      })();

      return updated;
    });
  };

  // -------------------------------------------------------
  // FOLLOWING USERS
  // -------------------------------------------------------
  const updateFollowedUsers = (userId: string, isFollowing: boolean) => {
    setFollowedUsers((prev) => {
      const updated = new Set(prev);
      isFollowing ? updated.add(userId) : updated.delete(userId);

      (async () => {
        await AsyncStorage.setItem(
          "followed_users",
          JSON.stringify(Array.from(updated))
        );
      })();

      return updated;
    });
  };

  // -------------------------------------------------------
  // SYNC FROM SERVER
  // -------------------------------------------------------
  const syncLikedPostsFromServer = async (postIds: string[]) => {
    if (!postIds?.length) return;

    try {
      const { likesApi } = await import("./api");
      const result = await likesApi.batchCheckStatus(postIds);

      if (result.status !== "success") {
        // Handle network errors gracefully - don't break the app
        const { isNetworkError } = require("./utils/network-error-handler");
        if (isNetworkError(result as any)) {
          console.warn('⚠️ Network error syncing liked posts - using cached data');
          return; // Use cached data instead
        }
        return;
      }

      const serverData = result.data || {};

      const likedIds: string[] = [];
      const counts: Record<string, number> = {};

      Object.entries(serverData).forEach(([id, status]) => {
        if (status.isLiked) likedIds.push(id);
        counts[id] = status.likeCount || 0;
      });

      // update context
      setLikedPosts(new Set(likedIds));
      setPostLikeCounts(new Map(Object.entries(counts)));

      // persist
      await AsyncStorage.setItem("liked_posts", JSON.stringify(likedIds));
      await AsyncStorage.setItem(
        "post_like_counts",
        JSON.stringify(counts)
      );

      // update Redux (optional)
      const { store } = await import("./store");
      const { setLikedPosts: setLikedPostsAction, setPostLikeCounts: setPostLikeCountsAction } = await import(
        "./store/slices/likesSlice"
      );
      store.dispatch(setLikedPostsAction(likedIds));
      store.dispatch(setPostLikeCountsAction(counts));
    } catch (e) {
      console.error("Sync error:", e);
    }
  };

  // -------------------------------------------------------
  // CLEAR CACHE
  // -------------------------------------------------------
  const clearCache = async () => {
    await Promise.all([
      AsyncStorage.removeItem("user_preferences"),
      AsyncStorage.removeItem("liked_posts"),
      AsyncStorage.removeItem("followed_users"),
      AsyncStorage.removeItem("post_like_counts"),
    ]);

    setPreferences(defaultPreferences);
    setLikedPosts(new Set());
    setFollowedUsers(new Set());
    setPostLikeCounts(new Map());
  };

  return (
    <CacheContext.Provider
      value={{
        preferences,
        updatePreferences,
        likedPosts,
        followedUsers,
        postLikeCounts,
        updateLikedPosts,
        updateFollowedUsers,
        updatePostLikeCount,
        syncLikedPostsFromServer,
        clearCache,
      }}
    >
      {children}
    </CacheContext.Provider>
  );
};

export const useCache = () => {
  const ctx = useContext(CacheContext);
  if (!ctx) throw new Error("useCache must be used within CacheProvider");
  return ctx;
};
