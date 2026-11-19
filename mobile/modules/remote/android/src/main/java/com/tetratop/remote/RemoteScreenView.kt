package com.tetratop.remote

import android.content.Context
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * A TextureView (not a SurfaceView) so React Native transforms such as pinch
 * zoom apply to the video. React Native never lays out natively added children,
 * so onLayout sizes the texture itself.
 */
class RemoteScreenView(context: Context, appContext: AppContext) :
    ExpoView(context, appContext),
    TextureView.SurfaceTextureListener {
    private val texture = TextureView(context)
    private var surface: Surface? = null
    private var videoWidth = 0
    private var videoHeight = 0
    private val sizeListener: (Int, Int) -> Unit = { width, height ->
        videoWidth = width
        videoHeight = height
        updateTransform()
    }

    init {
        setBackgroundColor(Color.BLACK)
        texture.surfaceTextureListener = this
        addView(texture, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val width = r - l
        val height = b - t
        texture.measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
        )
        texture.layout(0, 0, width, height)
        updateTransform()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        RemoteMedia.video.addSizeListener(sizeListener)
    }

    override fun onDetachedFromWindow() {
        RemoteMedia.video.removeSizeListener(sizeListener)
        super.onDetachedFromWindow()
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
        val s = Surface(st)
        surface = s
        RemoteMedia.video.attachSurface(s)
        updateTransform()
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
        updateTransform()
    }

    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        surface?.let {
            RemoteMedia.video.detachSurface(it)
            it.release()
        }
        surface = null
        return true
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit

    private fun updateTransform() {
        val viewWidth = texture.width.toFloat()
        val viewHeight = texture.height.toFloat()
        if (viewWidth <= 0f || viewHeight <= 0f || videoWidth <= 0 || videoHeight <= 0) {
            texture.setTransform(null)
            return
        }
        val scale = minOf(viewWidth / videoWidth, viewHeight / videoHeight)
        val matrix = Matrix()
        matrix.setScale(
            videoWidth * scale / viewWidth,
            videoHeight * scale / viewHeight,
            viewWidth / 2f,
            viewHeight / 2f,
        )
        texture.setTransform(matrix)
    }
}
