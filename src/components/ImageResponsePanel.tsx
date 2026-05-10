import type React from 'react';
import ReactMarkdown from 'react-markdown';
import styles from '../App.module.scss';
import type { SessionStatus } from '../app/architectureDecisions';

interface ImageResponsePanelProps {
  currentText: string;
  finalTexts: string[];
  imagePreview: string | null;
  imagePrompt: string;
  isExpanded: boolean;
  isImageUploading: boolean;
  selectedImage: File | null;
  sessionStatus: SessionStatus;
  onCancelImage: () => void;
  onImagePromptChange: (value: string) => void;
  onImageSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSendImage: () => void;
  onToggle: () => void;
}

export const ImageResponsePanel = ({
  currentText,
  finalTexts,
  imagePreview,
  imagePrompt,
  isExpanded,
  isImageUploading,
  selectedImage,
  sessionStatus,
  onCancelImage,
  onImagePromptChange,
  onImageSelect,
  onSendImage,
  onToggle,
}: ImageResponsePanelProps) => {
  const disabled = !sessionStatus.connected || !sessionStatus.sessionCreated;

  return (
    <div className={styles.secondary}>
      <div className={styles.imageUploadSection}>
        <button
          onClick={onToggle}
          className={styles.sectionToggle}
          title={isExpanded ? '切换到响应显示' : '切换到图片上传'}
          type="button"
        >
          {isExpanded ? '✉️' : '📷'}
        </button>

        <div className={`${styles.imageInputContent} ${isExpanded ? styles.expanded : styles.collapsed}`}>
          <input
            id="imageInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onImageSelect}
            style={{ display: 'none' }}
            disabled={disabled}
          />

          {!selectedImage ? (
            <div className={styles.imgLabelContainer}>
              <label
                htmlFor="imageInput"
                className={`${styles.imageUploadButton} ${disabled ? styles.disabled : ''}`}
              >
                📷 选择图片
              </label>

              {disabled && (
                <div className={styles.uploadTip}>
                  请先进行语音对话以建立会话
                </div>
              )}
            </div>
          ) : (
            <div className={styles.imagePreviewContainer}>
              {imagePreview && (
                <img
                  src={imagePreview}
                  alt="预览"
                  className={styles.imagePreview}
                />
              )}

              <div className={styles.promptInputContainer}>
                <textarea
                  placeholder="可选：输入额外的提示词或问题（留空则使用最后一轮对话内容）"
                  value={imagePrompt}
                  onChange={(event) => onImagePromptChange(event.target.value)}
                  className={styles.promptInput}
                  rows={3}
                  disabled={disabled}
                />
                <div className={styles.imageActions}>
                  <span className={styles.imageInfo}>
                    {selectedImage.name} ({(selectedImage.size / 1024 / 1024).toFixed(2)} MB)
                  </span>

                  <div className={styles.imageButtons}>
                    <button
                      onClick={onSendImage}
                      disabled={isImageUploading}
                      className={styles.sendButton}
                      type="button"
                    >
                      {isImageUploading ? '发送中...' : '发送图片'}
                    </button>
                    <button
                      onClick={onCancelImage}
                      className={styles.cancelButton}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={`${styles.responseTextDisplay} ${!isExpanded ? styles.expanded : styles.collapsed}`}>
          <div className={styles.responseContentWrapper}>
            <ReactMarkdown>
              {currentText || finalTexts[0] || '服务器响应信息'}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
};
