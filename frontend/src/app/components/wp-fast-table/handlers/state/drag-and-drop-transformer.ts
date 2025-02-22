import {Injector} from '@angular/core';
import {WorkPackageTable} from '../../wp-fast-table';
import {IsolatedQuerySpace} from "core-app/modules/work_packages/query-space/isolated-query-space";
import {take, takeUntil} from "rxjs/operators";
import {WorkPackageInlineCreateService} from "core-components/wp-inline-create/wp-inline-create.service";
import {WorkPackageNotificationService} from "core-components/wp-edit/wp-notification.service";
import {WorkPackageViewSortByService} from "core-app/modules/work_packages/routing/wp-view-base/view-services/wp-view-sort-by.service";
import {TableDragActionsRegistryService} from "core-components/wp-table/drag-and-drop/actions/table-drag-actions-registry.service";
import {TableDragActionService} from "core-components/wp-table/drag-and-drop/actions/table-drag-action.service";
import {States} from "core-components/states.service";
import {tableRowClassName} from "core-components/wp-fast-table/builders/rows/single-row-builder";
import {DragAndDropService} from "core-app/modules/common/drag-and-drop/drag-and-drop.service";
import {DragAndDropHelpers} from "core-app/modules/common/drag-and-drop/drag-and-drop.helpers";
import {WorkPackageViewOrderService} from "core-app/modules/work_packages/routing/wp-view-base/view-services/wp-view-order.service";
import {RenderedWorkPackage} from "core-app/modules/work_packages/render-info/rendered-work-package.type";
import {BrowserDetector} from "core-app/modules/common/browser/browser-detector.service";

export class DragAndDropTransformer {

  private readonly states:States = this.injector.get(States);
  private readonly querySpace:IsolatedQuerySpace = this.injector.get(IsolatedQuerySpace);
  private readonly dragService:DragAndDropService|null = this.injector.get(DragAndDropService, null);
  private readonly inlineCreateService = this.injector.get(WorkPackageInlineCreateService);
  private readonly wpNotifications = this.injector.get(WorkPackageNotificationService);
  private readonly wpTableSortBy = this.injector.get(WorkPackageViewSortByService);
  private readonly wpTableOrder = this.injector.get(WorkPackageViewOrderService);
  private readonly browserDetector = this.injector.get(BrowserDetector);

  private readonly dragActionRegistry = this.injector.get(TableDragActionsRegistryService);

  constructor(public readonly injector:Injector,
              public table:WorkPackageTable) {

    // The DragService may not have been provided
    // in which case we do not provide drag and drop
    if (this.dragService === null) {
      return;
    }

    this.inlineCreateService.newInlineWorkPackageCreated
      .pipe(takeUntil(this.querySpace.stopAllSubscriptions))
      .subscribe(async (wpId) => {
        const newOrder = await this.wpTableOrder.add(this.currentOrder, wpId);
        this.updateRenderedOrder(newOrder);
      });

    this.querySpace.stopAllSubscriptions
      .pipe(take(1))
      .subscribe(() => {
        this.dragService!.remove(this.table.tbody);
      });

    this.dragService.register({
      dragContainer: this.table.tbody,
      scrollContainers: [this.table.scrollContainer],
      accepts: () => true,
      moves: (el:any, source:any, handle:HTMLElement) => {
        if (!handle.classList.contains('wp-table--drag-and-drop-handle')) {
          return false;
        }

        const wpId:string = el.dataset.workPackageId!;
        const workPackage = this.states.workPackages.get(wpId).value!;
        return this.actionService.canPickup(workPackage);
      },
      onMoved: async (el:HTMLElement, target:HTMLElement, source:HTMLElement) => {
        const wpId:string = el.dataset.workPackageId!;
        const workPackage = this.states.workPackages.get(wpId).value!;
        const rowIndex = this.findRowIndex(el);

        try {
          const newOrder = await this.wpTableOrder.move(this.currentOrder, wpId, rowIndex);
          await this.actionService.handleDrop(workPackage, el);
          this.updateRenderedOrder(newOrder);
          this.actionService.onNewOrder(newOrder);
          this.wpTableSortBy.switchToManualSorting();
        } catch (e) {
          this.wpNotifications.handleRawError(e);

          // Restore element in from container
          DragAndDropHelpers.reinsert(el, el.dataset.sourceIndex || -1, source);
        }
      },
      onRemoved: (el:HTMLElement) => {
        const wpId:string = el.dataset.workPackageId!;
        const newOrder = this.wpTableOrder.remove(this.currentOrder, wpId);
        this.updateRenderedOrder(newOrder);
      },
      onAdded: (el:HTMLElement) => {
        const wpId:string = el.dataset.workPackageId!;
        const workPackage = this.states.workPackages.get(wpId).value!;
        const rowIndex = this.findRowIndex(el);

        return this.actionService
          .handleDrop(workPackage, el)
          .then(async () => {
            const newOrder = await this.wpTableOrder.add(this.currentOrder, wpId, rowIndex);
            this.updateRenderedOrder(newOrder);
            this.actionService.onNewOrder(newOrder);

            return true;
          })
          .catch(() => false);
      },
      onCloned: (clone:HTMLElement, original:HTMLElement) => {
        // Replace clone with one TD of the subject
        const wpId:string = original.dataset.workPackageId!;
        const workPackage = this.states.workPackages.get(wpId).value!;

        const colspan = clone.children.length;
        const td = document.createElement('td');
        td.textContent = workPackage.subjectWithId();
        td.colSpan = colspan;
        td.classList.add('wp-table--cell-td', 'subject');

        clone.style.maxWidth = '500px';
        clone.innerHTML = td.outerHTML;
      },
      onShadowInserted: (el:HTMLElement) => {
        if (!this.browserDetector.isEdge) {
          this.actionService.changeShadowElement(el);
        }
      },
      onCancel: (el:HTMLElement) => {
        if (!this.browserDetector.isEdge) {
          this.actionService.changeShadowElement(el, true);
        }
      },
    });
  }

  /**
   * Update current rendered order
   */
  private updateRenderedOrder(order:string[]) {
    order = _.uniq(order);

    const mappedOrder = order.map(id => this.states.workPackages.get(id).value!);

    /** Re-render the table */
    this.table.initialSetup(mappedOrder);
  }

  protected get actionService():TableDragActionService {
    return this.dragActionRegistry.get(this.injector);
  }

  protected get currentOrder():string[] {
    return this
      .currentRenderedOrder
      .map((row) => row.workPackageId!);
  }

  protected get currentRenderedOrder():RenderedWorkPackage[] {
    return this
      .querySpace
      .renderedWorkPackages
      .getValueOr([]);
  }

  /**
   * Find the index of the row in the set of rendered work packages.
   * This will skip non-work-package rows such as group headers
   * @param el
   */
  private findRowIndex(el:HTMLElement):number {
    const rows = Array.from(this.table.tbody.getElementsByClassName(tableRowClassName));
    return rows.indexOf(el) || 0;
  }
}
