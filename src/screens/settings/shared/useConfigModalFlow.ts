import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';

type UseConfigModalFlowParams<Section extends string> = {
  section: Section;
  setSection: Dispatch<SetStateAction<Section>>;
  editorSections: readonly Section[];
  mainSection: Section;
  resetEditor: () => void;
  isActive: boolean;
};

export function useConfigModalFlow<Section extends string>({
  section,
  setSection,
  editorSections,
  mainSection,
  resetEditor,
  isActive,
}: UseConfigModalFlowParams<Section>) {
  const editorSectionSet = useMemo(() => new Set(editorSections), [editorSections]);
  const isVisible = editorSectionSet.has(section);

  const openEditor = useCallback(
    (nextSection?: Section) => {
      const targetSection = nextSection ?? editorSections[0];
      if (targetSection) {
        setSection(targetSection);
      }
    },
    [editorSections, setSection],
  );

  const closeEditor = useCallback(() => {
    resetEditor();
    setSection(mainSection);
  }, [mainSection, resetEditor, setSection]);

  return {
    isActive,
    isVisible,
    openEditor,
    closeEditor,
  };
}
