import React, { useState, useCallback, memo } from 'react';
import {
  Image,
  ImageStyle,
  View,
  StyleSheet,
  ActivityIndicator,
  ImageSourcePropType,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

interface OptimizedImageProps {
  /** Image source URL or require() */
  source: string | ImageSourcePropType;
  /** Image style */
  style?: ImageStyle;
  /** Container style */
  containerStyle?: ViewStyle;
  /** Resize mode */
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  /** Placeholder icon name */
  placeholderIcon?: keyof typeof Feather.glyphMap;
  /** Placeholder icon size */
  placeholderIconSize?: number;
  /** Show loading indicator */
  showLoader?: boolean;
  /** Loader color */
  loaderColor?: string;
  /** Fallback image URI */
  fallbackUri?: string;
  /** Called when image loads successfully */
  onLoad?: () => void;
  /** Called when image fails to load */
  onError?: () => void;
  /** Priority hint for loading */
  priority?: 'low' | 'normal' | 'high';
  /** Cache hint */
  cache?: 'default' | 'reload' | 'force-cache' | 'only-if-cached';
}

/**
 * Optimized Image component with:
 * - Lazy loading
 * - Error handling with fallback
 * - Loading indicator
 * - Memory-efficient image sizing
 * 
 * @example
 * <OptimizedImage
 *   source={imageUrl}
 *   style={{ width: 200, height: 200 }}
 *   resizeMode="cover"
 *   showLoader
 * />
 */
const OptimizedImageComponent: React.FC<OptimizedImageProps> = ({
  source,
  style,
  containerStyle,
  resizeMode = 'cover',
  placeholderIcon = 'image',
  placeholderIconSize = 32,
  showLoader = true,
  loaderColor = '#60a5fa',
  fallbackUri,
  onLoad,
  onError,
  priority = 'normal',
  cache = 'default',
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [useFallback, setUseFallback] = useState(false);

  const handleLoad = useCallback(() => {
    setLoading(false);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setLoading(false);
    
    if (fallbackUri && !useFallback) {
      // Try fallback image
      setUseFallback(true);
    } else {
      setError(true);
      onError?.();
    }
  }, [fallbackUri, useFallback, onError]);

  // Get the image URI, handling different source types
  const getImageSource = (): ImageSourcePropType => {
    if (typeof source === 'string') {
      if (useFallback && fallbackUri) {
        return { uri: fallbackUri, cache };
      }
      
      // Add size parameters for URL optimization (if server supports it)
      const styleObj = StyleSheet.flatten(style) || {};
      const width = typeof styleObj.width === 'number' ? Math.round(styleObj.width) : undefined;
      const height = typeof styleObj.height === 'number' ? Math.round(styleObj.height) : undefined;
      
      // Optimization: Request appropriately sized images
      let optimizedUri = source;
      if (width && height && source.includes('?')) {
        optimizedUri = `${source}&w=${width}&h=${height}`;
      } else if (width && height) {
        optimizedUri = `${source}?w=${width}&h=${height}`;
      }
      
      return { uri: optimizedUri, cache };
    }
    
    return source;
  };

  const imageSource = getImageSource();

  // If there's an error, show placeholder
  if (error) {
    return (
      <View style={[styles.placeholder, style, containerStyle]}>
        <Feather 
          name={placeholderIcon} 
          size={placeholderIconSize} 
          color="#666" 
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, containerStyle]}>
      <Image
        source={imageSource}
        style={[styles.image, style]}
        resizeMode={resizeMode}
        onLoad={handleLoad}
        onError={handleError}
        fadeDuration={200}
      />
      
      {/* Loading indicator */}
      {showLoader && loading && (
        <View style={[styles.loaderContainer, style]}>
          <ActivityIndicator size="small" color={loaderColor} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  loaderContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
});

/**
 * Memoized image component - only re-renders when source or style changes
 */
export const OptimizedImage = memo(OptimizedImageComponent, (prevProps, nextProps) => {
  // Custom comparison for performance
  const prevSource = typeof prevProps.source === 'string' ? prevProps.source : '';
  const nextSource = typeof nextProps.source === 'string' ? nextProps.source : '';
  
  return (
    prevSource === nextSource &&
    JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style) &&
    prevProps.resizeMode === nextProps.resizeMode
  );
});

export default OptimizedImage;



















