import * as ImageManipulator from 'expo-image-manipulator';
import { captureRef } from 'react-native-view-shot';
import { View, Text, StyleSheet, Image } from 'react-native';
import React from 'react';
import watermarkLogo from '../../assets/images/watermark_logo.png';

/**
 * Creates a watermark image from text
 * Returns a base64 data URI of the watermark image
 */
export const createWatermarkImageDataUri = (appName: string, userId: string): string => {
  // Create a simple watermark as base64 data URI
  // This is a simple approach - for better quality, use canvas or SVG
  const canvas = `
    <svg width="200" height="80" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="80" fill="rgba(0,0,0,0.6)" rx="8"/>
      <text x="100" y="35" font-family="Arial" font-size="16" font-weight="700" fill="white" text-anchor="middle">${appName}</text>
      <text x="100" y="55" font-family="Arial" font-size="12" font-weight="500" fill="rgba(255,255,255,0.8)" text-anchor="middle">${userId}</text>
    </svg>
  `;
  
  // Convert SVG to data URI
  const svgDataUri = `data:image/svg+xml;base64,${btoa(canvas)}`;
  return svgDataUri;
};

interface WatermarkOverlayProps {
  appName: string;
  userId: string;
}

/**
 * Watermark component that can be captured with view-shot
 */
export const WatermarkOverlay = React.forwardRef(
  (props: WatermarkOverlayProps, ref: React.Ref<View>) => {
    const { appName, userId } = props;
    return (
      <View ref={ref} style={styles.watermarkContainer} collapsable={false}>
        <View style={styles.watermarkBackground}>
          <Image source={watermarkLogo} style={styles.watermarkLogo} resizeMode="contain" />
          <Text style={styles.watermarkUserId}>{userId}</Text>
        </View>
      </View>
    );
  }
) as React.ForwardRefExoticComponent<WatermarkOverlayProps & React.RefAttributes<View>>;

WatermarkOverlay.displayName = 'WatermarkOverlay';

const styles = StyleSheet.create({
  watermarkContainer: {
    position: 'absolute',
    top: '40%',
    // Hug the right edge as much as possible (some slight clipping is acceptable)
    right: -2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermarkBackground: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  watermarkLogo: {
    width: 80,
    height: 80,
  },
  watermarkUserId: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
});

/**
 * Composites a watermark onto an image using view-shot
 * This requires rendering the image with watermark overlay and capturing it
 */
export const addWatermarkToImageWithViewShot = async (
  imageUri: string,
  compositeViewRef: React.RefObject<View | null>
): Promise<string> => {
  try {
    if (!compositeViewRef.current) {
      console.warn('Composite view ref not available');
      return imageUri;
    }

    // Capture the composite view (image + watermark overlay)
    const watermarkedUri = await captureRef(compositeViewRef as React.RefObject<View>, {
      format: 'jpg',
      quality: 0.9,
    });

    return watermarkedUri;
  } catch (error) {
    console.error('Error capturing watermarked image:', error);
    return imageUri;
  }
};
