import AdaptiveGroups from './AdaptiveGroups.jsx';
import { DrawingGroups } from './DrawingTab.jsx';
import { CommentGroups } from './CommentTab.jsx';

// Merged "Tekenen & annotatie" tab (issue #278): combines the former
// "Tekenen" (Drawing) and "Opmerkingen" (Comment) tabs into a single tab.
// Both group-sets are composed inside one AdaptiveGroups container so the
// existing overflow / icon-only shrinking behaviour keeps working across the
// combined set. Drawing groups come first, followed by the comment/markup
// groups.
export default function AnnotateTab() {
  return (
    <div class="ribbon-content active" id="tab-drawing">
      <AdaptiveGroups>
        <DrawingGroups />
        <CommentGroups />
      </AdaptiveGroups>
    </div>
  );
}
