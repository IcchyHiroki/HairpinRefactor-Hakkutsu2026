package v1

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

const (
	GameServerSetKind = "GameServerSet"

	GameServerSetPodFinalizer = "gameserverset.game.example.com/delay-deletion"

	GameServerSetLabelKey = "game.example.com/gameserverset-name"
)

type GameServerSetSpec struct {
	Replicas           *int32      `json:"replicas"`
	DeleteDelaySeconds *int32      `json:"deleteDelaySeconds"`
	Template           PodTemplate `json:"template"`
}

type PodTemplate struct {
	// +optional
	ObjectMeta PodTemplateObjectMeta `json:"metadata,omitempty"`
	Spec       corev1.PodSpec        `json:"spec"`
}

type PodTemplateObjectMeta struct {
	// +optional
	Labels map[string]string `json:"labels,omitempty"`
	// +optional
	Annotations map[string]string `json:"annotations,omitempty"`
}

type GameServerSetStatus struct {
	ReadyReplicas int32              `json:"readyReplicas,omitempty"`
	Conditions    []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced
// +kubebuilder:printcolumn:name="Replicas",type=integer,JSONPath=".spec.replicas"
// +kubebuilder:printcolumn:name="Ready",type=integer,JSONPath=".status.readyReplicas"
// +kubebuilder:printcolumn:name="Delay",type=integer,JSONPath=".spec.deleteDelaySeconds"

type GameServerSet struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitzero"`

	Spec   GameServerSetSpec   `json:"spec"`
	// +optional
	Status GameServerSetStatus `json:"status,omitzero"`
}

// +kubebuilder:object:root=true

type GameServerSetList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitzero"`
	Items           []GameServerSet `json:"items"`
}

func init() {
	SchemeBuilder.Register(func(s *runtime.Scheme) error {
		s.AddKnownTypes(SchemeGroupVersion, &GameServerSet{}, &GameServerSetList{})
		return nil
	})
}
