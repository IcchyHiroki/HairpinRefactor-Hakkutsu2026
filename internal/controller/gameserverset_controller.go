package controller

import (
	"context"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/predicate"

	gamev1 "github.com/you/gameserver-operator/api/v1"
)

const controllerName = "gameserverset"

const delayFinalizer = gamev1.GameServerSetPodFinalizer

type GameServerSetReconciler struct {
	client.Client
	Scheme *runtime.Scheme
}

// +kubebuilder:rbac:groups=game.game.example.com,resources=gameserversets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=game.game.example.com,resources=gameserversets/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=game.game.example.com,resources=gameserversets/finalizers,verbs=update
// +kubebuilder:rbac:groups=core,resources=pods,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=core,resources=pods/finalizers,verbs=update

func (r *GameServerSetReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := logf.FromContext(ctx).WithName(controllerName)

	gss := &gamev1.GameServerSet{}
	if err := r.Get(ctx, req.NamespacedName, gss); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	replicas := int32(1)
	if gss.Spec.Replicas != nil && *gss.Spec.Replicas > 0 {
		replicas = *gss.Spec.Replicas
	}
	delaySec := int32(0)
	if gss.Spec.DeleteDelaySeconds != nil && *gss.Spec.DeleteDelaySeconds > 0 {
		delaySec = *gss.Spec.DeleteDelaySeconds
	}

	var pods corev1.PodList
	if err := r.List(ctx, &pods, client.InNamespace(req.Namespace), client.MatchingLabels{
		gamev1.GameServerSetLabelKey: gss.Name,
	}); err != nil {
		log.Error(err, "Failed to list pods")
		return ctrl.Result{}, err
	}

	var activePods []corev1.Pod
	var terminatingPods []corev1.Pod
	for _, pod := range pods.Items {
		if pod.DeletionTimestamp != nil {
			terminatingPods = append(terminatingPods, pod)
		} else {
			activePods = append(activePods, pod)
		}
	}

	for i := range terminatingPods {
		pod := terminatingPods[i]
		log := log.WithValues("pod", pod.Name)

		if !hasFinalizer(&pod, delayFinalizer) {
			continue
		}

		log.Info("Waiting before allowing pod deletion", "delaySeconds", delaySec)
		select {
		case <-time.After(time.Duration(delaySec) * time.Second):
		case <-ctx.Done():
			return ctrl.Result{}, ctx.Err()
		}

		latest := &corev1.Pod{}
		if err := r.Get(ctx, types.NamespacedName{Name: pod.Name, Namespace: pod.Namespace}, latest); err != nil {
			log.Error(err, "Failed to re-fetch pod for finalizer removal")
			continue
		}
		if !hasFinalizer(latest, delayFinalizer) {
			log.Info("Finalizer already removed, skipping")
			continue
		}

		log.Info("Removing delay finalizer, allowing pod deletion")
		removeFinalizer(latest, delayFinalizer)
		if err := r.Update(ctx, latest); err != nil {
			log.Error(err, "Failed to remove finalizer, skipping")
			continue
		}
	}

	activeCount := int32(len(activePods))
	if activeCount < replicas {
		desiredNew := replicas - activeCount
		log.Info("Creating new pods", "count", desiredNew, "active", activeCount, "desired", replicas)
		for i := int32(0); i < desiredNew; i++ {
			pod := buildPod(gss)
			if err := ctrl.SetControllerReference(gss, pod, r.Scheme); err != nil {
				log.Error(err, "Failed to set controller reference")
				return ctrl.Result{}, err
			}
			if err := r.Create(ctx, pod); err != nil {
				log.Error(err, "Failed to create pod")
				return ctrl.Result{}, err
			}
		}
	}

	var readyCount int32
	for _, pod := range activePods {
		for _, cond := range pod.Status.Conditions {
			if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
				readyCount++
				break
			}
		}
	}

	if gss.Status.ReadyReplicas != readyCount {
		gss.Status.ReadyReplicas = readyCount
		if err := r.Status().Update(ctx, gss); err != nil {
			log.V(1).Info("Status update conflict, will retry", "error", err.Error())
			return ctrl.Result{}, err
		}
	}

	return ctrl.Result{}, nil
}

func (r *GameServerSetReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&gamev1.GameServerSet{}).
		Owns(&corev1.Pod{}).
		Named(controllerName).
		WithEventFilter(podStatusChangePredicate()).
		Complete(r)
}

func buildPod(gss *gamev1.GameServerSet) *corev1.Pod {
	labels := make(map[string]string)
	for k, v := range gss.Spec.Template.ObjectMeta.Labels {
		labels[k] = v
	}
	labels[gamev1.GameServerSetLabelKey] = gss.Name

	annotations := make(map[string]string)
	for k, v := range gss.Spec.Template.ObjectMeta.Annotations {
		annotations[k] = v
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: gss.Name + "-",
			Namespace:    gss.Namespace,
			Labels:       labels,
			Annotations:  annotations,
			Finalizers:   []string{delayFinalizer},
		},
		Spec: gss.Spec.Template.Spec,
	}
	return pod
}

func hasFinalizer(pod *corev1.Pod, finalizer string) bool {
	for _, f := range pod.Finalizers {
		if f == finalizer {
			return true
		}
	}
	return false
}

func removeFinalizer(pod *corev1.Pod, finalizer string) {
	var updated []string
	for _, f := range pod.Finalizers {
		if f != finalizer {
			updated = append(updated, f)
		}
	}
	pod.Finalizers = updated
}

func podStatusChangePredicate() predicate.Predicate {
	return predicate.Funcs{
		UpdateFunc: func(e event.UpdateEvent) bool {
			return true
		},
		CreateFunc: func(e event.CreateEvent) bool {
			return true
		},
		DeleteFunc: func(e event.DeleteEvent) bool {
			return true
		},
		GenericFunc: func(e event.GenericEvent) bool {
			return false
		},
	}
}
